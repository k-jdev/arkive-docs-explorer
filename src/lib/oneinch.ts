// Thin wrapper around 1inch Aggregation Protocol v6 (Ethereum mainnet, chain id 1).
// Docs: https://portal.1inch.dev/documentation/apis/swap/classic-swap/quick-start

const CHAIN_ID = 1;
const BASE = `https://api.1inch.dev/swap/v6.0/${CHAIN_ID}`;

// 1inch uses this sentinel for native ETH
export const NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;

function authHeaders(): HeadersInit {
  const key = process.env.ONEINCH_API_KEY;
  if (!key) throw new Error("ONEINCH_API_KEY is not set in .env.local");
  return { Authorization: `Bearer ${key}`, accept: "application/json" };
}

async function get<T>(pathname: string, params: Record<string, string | number | boolean>): Promise<T> {
  const url = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`1inch ${pathname} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

export type OneInchToken = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

export type OneInchTokenMap = Record<string, OneInchToken>;

let _tokenCache: { fetchedAt: number; tokens: OneInchTokenMap } | undefined;

export async function getTokens(): Promise<OneInchTokenMap> {
  const FRESH_MS = 1000 * 60 * 60; // 1 hour
  if (_tokenCache && Date.now() - _tokenCache.fetchedAt < FRESH_MS) {
    return _tokenCache.tokens;
  }
  const data = await get<{ tokens: OneInchTokenMap }>("/tokens", {});
  _tokenCache = { fetchedAt: Date.now(), tokens: data.tokens };
  return data.tokens;
}

export async function findToken(query: string): Promise<OneInchToken | undefined> {
  const q = query.trim().toLowerCase();
  if (q === "eth") {
    return { address: NATIVE_TOKEN as `0x${string}`, symbol: "ETH", name: "Ether", decimals: 18 };
  }
  const tokens = await getTokens();
  // exact address match first
  if (q.startsWith("0x") && tokens[q]) return tokens[q];
  // exact symbol match (prefer the canonical entry — pick the one with the highest market presence by name length heuristic)
  const symMatches = Object.values(tokens).filter((t) => t.symbol.toLowerCase() === q);
  if (symMatches.length > 0) {
    return symMatches.sort((a, b) => a.name.length - b.name.length)[0];
  }
  // name contains
  const nameMatches = Object.values(tokens).filter((t) => t.name.toLowerCase().includes(q));
  if (nameMatches.length === 1) return nameMatches[0];
  return undefined;
}

export type QuoteResponse = {
  dstAmount: string; // wei of dst token
  srcToken: OneInchToken;
  dstToken: OneInchToken;
};

export async function quote(args: {
  src: string;
  dst: string;
  amountWei: string;
}): Promise<QuoteResponse> {
  return get<QuoteResponse>("/quote", {
    src: args.src,
    dst: args.dst,
    amount: args.amountWei,
    includeTokensInfo: true,
  });
}

export type SwapTx = {
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string; // wei, decimal string
  gas?: string;
  gasPrice?: string;
};

export type SwapResponse = {
  dstAmount: string;
  tx: SwapTx;
  srcToken: OneInchToken;
  dstToken: OneInchToken;
};

export async function buildSwap(args: {
  src: string;
  dst: string;
  amountWei: string;
  from: string;
  slippageBps: number; // 50 = 0.5%
}): Promise<SwapResponse> {
  // 1inch uses % (with decimals) for slippage, e.g. 0.5
  const slippagePct = args.slippageBps / 100;
  return get<SwapResponse>("/swap", {
    src: args.src,
    dst: args.dst,
    amount: args.amountWei,
    from: args.from,
    slippage: slippagePct,
    includeTokensInfo: true,
    disableEstimate: false,
  });
}

export type ApproveTx = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  gasPrice?: string;
};

export async function getApproveTx(args: { token: string; amountWei: string }): Promise<ApproveTx> {
  return get<ApproveTx>("/approve/transaction", { tokenAddress: args.token, amount: args.amountWei });
}

export async function getApproveSpender(): Promise<{ address: `0x${string}` }> {
  return get<{ address: `0x${string}` }>("/approve/spender", {});
}
