import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  formatUnits,
  parseUnits,
  erc20Abi,
  type PublicClient,
  type WalletClient,
  type Address,
} from "viem";
import { getChain, rpcUrl, type ChainId } from "@/lib/chains";
import type { PrivateKeyAccount } from "viem";

const _publicClients = new Map<ChainId, PublicClient>();

export function publicClient(chain: ChainId = "ethereum"): PublicClient {
  let c = _publicClients.get(chain);
  if (!c) {
    const cfg = getChain(chain);
    c = createPublicClient({ chain: cfg.viem, transport: http(rpcUrl(cfg)) });
    _publicClients.set(chain, c);
  }
  return c;
}

export function walletClientFor(account: PrivateKeyAccount, chain: ChainId = "ethereum"): WalletClient {
  const cfg = getChain(chain);
  return createWalletClient({ account, chain: cfg.viem, transport: http(rpcUrl(cfg)) });
}

export async function getEthBalance(address: Address, chain: ChainId = "ethereum") {
  const wei = await publicClient(chain).getBalance({ address });
  return { wei: wei.toString(), eth: formatEther(wei) };
}

export async function getTokenBalance(address: Address, token: Address, chain: ChainId = "ethereum") {
  const [bal, decimals, symbol] = await Promise.all([
    publicClient(chain).readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    publicClient(chain).readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    publicClient(chain).readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return {
    wei: (bal as bigint).toString(),
    formatted: formatUnits(bal as bigint, decimals as number),
    decimals: decimals as number,
    symbol: symbol as string,
  };
}

export async function getAllowance(
  owner: Address,
  spender: Address,
  token: Address,
  chain: ChainId = "ethereum"
): Promise<bigint> {
  return (await publicClient(chain).readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
}

export { formatUnits, parseUnits, formatEther, erc20Abi };
