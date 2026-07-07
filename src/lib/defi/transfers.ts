// ETH and ERC-20 transfers — building, simulating, executing.
//
// Pattern: an MCP `request_transfer` tool calls `prepareTransfer()` to validate
// the input (resolve ENS, look up token, check balance), then enqueues the
// resulting PendingTransfer row. On user approval, `executeTransfer()` runs
// the actual send via viem's walletClient.
//
// We do NOT enforce a min-gas check here — the wallet client will revert if
// the sender can't cover gas, and the user sees that as a "failed" status with
// the underlying revert message. Acceptable trade-off; a pre-flight gas check
// would require an eth_estimateGas + balance read per request and we'd still
// fall back to the same revert path on edge cases.

import { encodeFunctionData, parseUnits, formatUnits, type Address, type Hex, type WalletClient } from "viem";
import { mainnet } from "viem/chains";
import { createPublicClient, http } from "viem";
import { ERC20_TRANSFER_APPROVE_ABI } from "./abis";
import { getChain, rpcUrl, type ChainId } from "@/lib/chains";
import { publicClient, getEthBalance, getTokenBalance } from "@/lib/eth";
import { findToken, isNativeEth } from "@/lib/uniswap";

export type ResolvedRecipient = {
  address: Address;
  /** If the input was an ENS name, keep it for display + audit. */
  ens?: string;
};

/**
 * Resolve a recipient string to an address. Accepts:
 *   - "0x..." (40 hex chars) — returned as-is, checksummed
 *   - "*.eth" — resolved via Ethereum mainnet ENS (works regardless of target chain;
 *     ENS lives on mainnet and the resulting address is the same everywhere)
 *
 * Throws on unresolvable inputs.
 */
export async function resolveRecipient(input: string): Promise<ResolvedRecipient> {
  const trimmed = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    const { getAddress } = await import("viem");
    return { address: getAddress(trimmed) as Address };
  }
  if (trimmed.toLowerCase().endsWith(".eth") || trimmed.toLowerCase().endsWith(".xyz") || trimmed.includes(".")) {
    // Use a dedicated mainnet client for ENS — ENS is on mainnet regardless of where the user is sending.
    const mainnetClient = createPublicClient({
      chain: mainnet,
      transport: http(process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com"),
    });
    const resolved = await mainnetClient.getEnsAddress({ name: trimmed }).catch(() => null);
    if (!resolved) throw new Error(`Could not resolve ENS name: ${trimmed}`);
    return { address: resolved as Address, ens: trimmed };
  }
  throw new Error(
    `Recipient "${input}" is not a valid address or ENS name. Expected 0x… (40 hex chars) or a name like alice.eth.`
  );
}

export type TransferPlan =
  | {
      kind: "eth";
      to: Address;
      toEns?: string;
      amount: string;
      amountWei: string;
    }
  | {
      kind: "erc20";
      to: Address;
      toEns?: string;
      token: { address: Address; symbol: string; decimals: number };
      amount: string;
      amountWei: string;
    };

/**
 * Validate + assemble a transfer. Resolves the recipient (ENS) and the asset
 * (symbol → token), checks balance, and returns the plan that will be persisted
 * onto the pending queue.
 */
export async function prepareTransfer(args: {
  from: Address;
  to: string;
  amount: string;
  /** "ETH" / "USDC" / etc., OR a 0x token address. Defaults to "ETH". */
  asset?: string;
  chain: ChainId;
}): Promise<TransferPlan> {
  const recipient = await resolveRecipient(args.to);
  const assetKey = (args.asset ?? "ETH").trim();

  // ETH path
  if (assetKey.toUpperCase() === "ETH") {
    const bal = await getEthBalance(args.from, args.chain);
    const amountWei = parseUnits(args.amount, 18);
    if (BigInt(bal.wei) < amountWei) {
      throw new Error(
        `Insufficient ETH. Wallet has ${bal.eth}, transfer requests ${args.amount} (plus gas).`
      );
    }
    return {
      kind: "eth",
      to: recipient.address,
      toEns: recipient.ens,
      amount: args.amount,
      amountWei: amountWei.toString(),
    };
  }

  // ERC-20 path — resolve symbol/address via Uniswap tokenlist + on-chain fallback
  const token = await findToken(assetKey, args.chain);
  if (!token) throw new Error(`Could not find token "${assetKey}" on ${args.chain}.`);
  if (isNativeEth(token)) {
    // Re-route: user typed "ETH" via a different alias
    return prepareTransfer({ ...args, asset: "ETH" });
  }
  const tb = await getTokenBalance(args.from, token.address as Address, args.chain);
  const amountWei = parseUnits(args.amount, token.decimals);
  if (BigInt(tb.wei) < amountWei) {
    throw new Error(
      `Insufficient ${token.symbol}. Wallet has ${tb.formatted}, transfer requests ${args.amount}.`
    );
  }
  return {
    kind: "erc20",
    to: recipient.address,
    toEns: recipient.ens,
    token: { address: token.address as Address, symbol: token.symbol, decimals: token.decimals },
    amount: args.amount,
    amountWei: amountWei.toString(),
  };
}

/**
 * Execute a transfer at approval time. Returns the broadcast tx hash.
 *
 * For ETH: a plain `sendTransaction({to, value})`.
 * For ERC-20: `token.transfer(to, amount)` via the token contract.
 */
export async function executeTransfer(args: {
  plan:
    | { kind: "eth"; to: Address; amountWei: string }
    | { kind: "erc20"; to: Address; token: { address: Address }; amountWei: string };
  chain: ChainId;
  wallet: WalletClient;
}): Promise<{ hash: Hex }> {
  if (args.plan.kind === "eth") {
    const hash = await args.wallet.sendTransaction({
      account: args.wallet.account!,
      chain: args.wallet.chain,
      to: args.plan.to,
      value: BigInt(args.plan.amountWei),
    });
    return { hash };
  }
  // ERC-20
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_APPROVE_ABI,
    functionName: "transfer",
    args: [args.plan.to, BigInt(args.plan.amountWei)],
  });
  const hash = await args.wallet.sendTransaction({
    account: args.wallet.account!,
    chain: args.wallet.chain,
    to: args.plan.token.address,
    data,
    value: 0n,
  });
  return { hash };
}

/** Read-only gas estimate (best effort — may revert on edge cases). */
export async function estimateTransferGas(args: {
  from: Address;
  plan: TransferPlan;
  chain: ChainId;
}): Promise<{ gas: string; gasPriceGwei: string; estCostEth: string }> {
  const client = publicClient(args.chain);
  let gas: bigint;
  if (args.plan.kind === "eth") {
    gas = await client
      .estimateGas({
        account: args.from,
        to: args.plan.to,
        value: BigInt(args.plan.amountWei),
      })
      .catch(() => 21_000n);
  } else {
    const data = encodeFunctionData({
      abi: ERC20_TRANSFER_APPROVE_ABI,
      functionName: "transfer",
      args: [args.plan.to, BigInt(args.plan.amountWei)],
    });
    gas = await client
      .estimateGas({
        account: args.from,
        to: args.plan.token.address,
        data,
      })
      .catch(() => 65_000n);
  }
  const gasPrice = await client.getGasPrice();
  const cost = gas * gasPrice;
  return {
    gas: gas.toString(),
    gasPriceGwei: formatUnits(gasPrice, 9),
    estCostEth: formatUnits(cost, 18),
  };
}

// Re-export for callers that just need the public client for a chain
export { rpcUrl, getChain };
