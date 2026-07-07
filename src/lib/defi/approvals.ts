// ERC-20 approvals — encode, simulate, read current allowance.
//
// Most DeFi flows (LP add, swaps via router) need the user to approve the protocol
// to spend their token first. Many tools handle this implicitly inside their swap
// flow (see uniswap.ts approval logic), but exposing approve_token as a first-class
// MCP tool lets Claude pre-approve in advance or handle non-router approvals
// (e.g. approving a vault contract).

import { encodeFunctionData, type Address, type Hex, type WalletClient } from "viem";
import { ERC20_TRANSFER_APPROVE_ABI, MAX_UINT256 } from "./abis";
import { publicClient } from "@/lib/eth";
import { findToken } from "@/lib/uniswap";
import type { ChainId } from "@/lib/chains";

export type ApprovePlan = {
  token: { address: Address; symbol: string; decimals: number };
  spender: Address;
  /** "max" or a human-readable amount. */
  amount: string;
  amountWei: string;
};

const MAX_AMOUNT_KEYWORDS = new Set(["max", "infinite", "unlimited", "uint256_max"]);

export async function prepareApprove(args: {
  owner: Address;
  token: string;
  spender: string;
  /** "max" or specific human amount. */
  amount: string;
  chain: ChainId;
}): Promise<ApprovePlan> {
  const token = await findToken(args.token, args.chain);
  if (!token) throw new Error(`Could not find token "${args.token}" on ${args.chain}.`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.spender)) {
    throw new Error(`Spender "${args.spender}" is not a valid address.`);
  }
  const { getAddress, parseUnits } = await import("viem");
  const spender = getAddress(args.spender) as Address;

  let amountWei: bigint;
  if (MAX_AMOUNT_KEYWORDS.has(args.amount.toLowerCase())) {
    amountWei = MAX_UINT256;
  } else {
    amountWei = parseUnits(args.amount, token.decimals);
  }

  return {
    token: { address: token.address as Address, symbol: token.symbol, decimals: token.decimals },
    spender,
    amount: args.amount,
    amountWei: amountWei.toString(),
  };
}

/** Current allowance — useful for tools to check whether re-approval is needed. */
export async function getAllowance(args: {
  owner: Address;
  token: Address;
  spender: Address;
  chain: ChainId;
}): Promise<bigint> {
  const client = publicClient(args.chain);
  return client.readContract({
    address: args.token,
    abi: ERC20_TRANSFER_APPROVE_ABI,
    functionName: "allowance",
    args: [args.owner, args.spender],
  });
}

export async function executeApprove(args: {
  plan: ApprovePlan;
  chain: ChainId;
  wallet: WalletClient;
}): Promise<{ hash: Hex }> {
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_APPROVE_ABI,
    functionName: "approve",
    args: [args.plan.spender, BigInt(args.plan.amountWei)],
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
