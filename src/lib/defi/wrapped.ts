// WETH wrap / unwrap.
//
// wrap_eth   : ETH → WETH via WETH9.deposit{value: amount}()
// unwrap_weth: WETH → ETH via WETH9.withdraw(amount)
//
// Both contracts on Ethereum + Base expose the same ABI. We pull the WETH address
// from the chain config (chains.ts → v2.weth).

import { encodeFunctionData, parseUnits, type Address, type Hex, type WalletClient } from "viem";
import { WETH_ABI } from "./abis";
import { getChain, type ChainId } from "@/lib/chains";
import { publicClient, getEthBalance, getTokenBalance } from "@/lib/eth";

export type WrapPlan = {
  kind: "wrap_eth" | "unwrap_weth";
  amount: string;
  amountWei: string;
  weth: Address;
};

export async function prepareWrap(args: {
  owner: Address;
  amount: string;
  chain: ChainId;
  /** "wrap" or "unwrap". */
  direction: "wrap" | "unwrap";
}): Promise<WrapPlan> {
  const cfg = getChain(args.chain);
  const amountWei = parseUnits(args.amount, 18);

  if (args.direction === "wrap") {
    const bal = await getEthBalance(args.owner, args.chain);
    if (BigInt(bal.wei) < amountWei) {
      throw new Error(`Insufficient ETH. Wallet has ${bal.eth}, wrap requests ${args.amount} (plus gas).`);
    }
    return {
      kind: "wrap_eth",
      amount: args.amount,
      amountWei: amountWei.toString(),
      weth: cfg.v2.weth,
    };
  }
  // unwrap
  const wb = await getTokenBalance(args.owner, cfg.v2.weth, args.chain);
  if (BigInt(wb.wei) < amountWei) {
    throw new Error(`Insufficient WETH. Wallet has ${wb.formatted}, unwrap requests ${args.amount}.`);
  }
  return {
    kind: "unwrap_weth",
    amount: args.amount,
    amountWei: amountWei.toString(),
    weth: cfg.v2.weth,
  };
}

export async function executeWrap(args: {
  plan: WrapPlan;
  chain: ChainId;
  wallet: WalletClient;
}): Promise<{ hash: Hex }> {
  if (args.plan.kind === "wrap_eth") {
    const data = encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" });
    const hash = await args.wallet.sendTransaction({
      account: args.wallet.account!,
      chain: args.wallet.chain,
      to: args.plan.weth,
      data,
      value: BigInt(args.plan.amountWei),
    });
    return { hash };
  }
  // unwrap
  const data = encodeFunctionData({
    abi: WETH_ABI,
    functionName: "withdraw",
    args: [BigInt(args.plan.amountWei)],
  });
  const hash = await args.wallet.sendTransaction({
    account: args.wallet.account!,
    chain: args.wallet.chain,
    to: args.plan.weth,
    data,
    value: 0n,
  });
  return { hash };
}

// Re-export to satisfy unused-import lint when this module is loaded for its types alone.
export { publicClient };
