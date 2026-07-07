// UniswapX integration — limit orders + TWAP (chunked limit orders).
//
// UniswapX is Uniswap's off-chain order-flow auction. Orders are signed
// off-chain (EIP-712), broadcast publicly, and filled by competing
// fillers who pay the gas. From the user's perspective: zero gas cost to
// submit, only fills when the price hits (limit orders) or the time
// window elapses (Dutch / priority orders).
//
// Flow this module implements:
//
//   1. getQuote()    POST /v1/quote
//                    returns an encoded order + EIP-712 typed data
//   2. signQuote()   sign the typed data via the unlocked wallet
//   3. submitOrder() POST /v1/order with signature + quote
//   4. getStatus() / listOrders() — order lifecycle reads
//
// Reactor addresses per chain (off-chain orders settle through these on-chain):
//   ethereum   V2 / V3 reactor (multiple versions)
//   base       PriorityOrderReactor 0x000000001Ec5656dcdB24D90DFa42742738De729
//
// API SHAPE NOTE — verified from https://developers.uniswap.org/docs/api-reference
// as of build time. If submission calls start failing with field-name errors,
// the Trade API has shifted. Run `curl -H "x-api-key: $UNISWAP_API_KEY"
// https://trade-api.gateway.uniswap.org/v1/quote -d '{...}'` to see current
// error shape and update the request body accordingly.

import { type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem";
import { type ChainId, getChain } from "@/lib/chains";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRADE_API_BASE = "https://trade-api.gateway.uniswap.org/v1";

/** UniswapX is deployed on these EVM chains per the docs (Eth mainnet,
 *  Arbitrum, Base, Unichain). We only enable the chains the rest of the
 *  app supports. */
export const UNISWAPX_SUPPORTED_CHAINS: ChainId[] = ["ethereum", "base"];

/** Reactor contract addresses — used as the on-chain settlement contract
 *  for cancellations. Off-chain orders themselves carry the reactor
 *  address in their encoded payload; we only need this for explicit
 *  on-chain cancel calls (which most users skip — letting the deadline
 *  expire is free). */
const REACTORS: Record<ChainId, Address> = {
  ethereum: "0x00000011F84B9aa48e5f8aA8B9897600006289Be", // V2DutchOrderReactor
  base: "0x000000001Ec5656dcdB24D90DFa42742738De729",      // PriorityOrderReactor
};

// ---------------------------------------------------------------------------
// Types — these mirror the Trade API request/response shapes documented at
// https://developers.uniswap.org/docs/api-reference. Kept as `unknown`-typed
// inner objects where the docs are imprecise, so we don't enforce a shape
// the API might tighten or loosen.
// ---------------------------------------------------------------------------

export type RoutingPreference =
  /** Off-chain UniswapX order. The classifier picks DUTCH_V2 / DUTCH_V3 /
   *  LIMIT_ORDER / PRIORITY based on chain + order params. */
  | "UNISWAPX_V2"
  /** Force a classic on-chain swap (skip UniswapX). */
  | "CLASSIC"
  /** Let the API choose. */
  | "BEST_PRICE";

/** Routing values returned by the quote endpoint, fed back into submission. */
export type Routing =
  | "DUTCH_V2"
  | "DUTCH_V3"
  | "LIMIT_ORDER"
  | "PRIORITY"
  | "CLASSIC";

export type QuoteRequest = {
  tokenIn: Address;
  tokenOut: Address;
  /** Amount in wei (smallest token unit). */
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  tokenInChainId: number;
  tokenOutChainId: number;
  /** EOA that will sign + receive. */
  swapper: Address;
  /** Drives which UniswapX variant the API selects. */
  routingPreference?: RoutingPreference;
  /** Slippage as basis points (e.g. 100 = 1%). The API also accepts
   *  autoSlippage:true for dynamic. */
  slippageTolerance?: number;
  /** Order deadline in seconds-since-epoch. UniswapX orders expire after. */
  deadline?: number;
  /** Reserved for future fields the API supports but we don't care about. */
  [k: string]: unknown;
};

export type QuoteResponse = {
  /** What the API decided to do with the request. Drives the next submit call. */
  routing: Routing;
  /** Opaque quote object — pass back verbatim to submitOrder(). Carries the
   *  encoded order + EIP-712 typed-data envelope. */
  quote: {
    /** EIP-712 typed data ready to sign. Shape varies per routing. */
    orderInfo?: {
      domain: { name: string; chainId: number; verifyingContract: Address };
      types: Record<string, Array<{ name: string; type: string }>>;
      values: Record<string, unknown>;
    };
    /** Some routings return a pre-encoded permit blob to sign directly. */
    permitData?: {
      domain: { name: string; chainId: number; verifyingContract: Address };
      types: Record<string, Array<{ name: string; type: string }>>;
      values: Record<string, unknown>;
    };
    /** Everything else is opaque and passes through. */
    [k: string]: unknown;
  };
  requestId?: string;
};

export type SubmitOrderRequest = {
  signature: Hex;
  /** Verbatim from QuoteResponse.quote. */
  quote: QuoteResponse["quote"];
  routing: Routing;
};

export type SubmitOrderResponse = {
  orderId: string;
  orderStatus:
    | "open"
    | "filled"
    | "expired"
    | "cancelled"
    | "error"
    | string; // future-proof
  requestId?: string;
};

export type OrderStatus = {
  orderId: string;
  orderStatus: SubmitOrderResponse["orderStatus"];
  /** Filled amount in wei if partial/complete. */
  fillAmount?: string;
  /** Transaction hash of the fill, if filled. */
  txHash?: Hex;
  /** When the order will/did expire. */
  deadline?: number;
  /** Whatever else the API returns. */
  [k: string]: unknown;
};

// ---------------------------------------------------------------------------
// API key + headers
// ---------------------------------------------------------------------------

function requireApiKey(): string {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) {
    throw new Error(
      "UNISWAP_API_KEY is not set in .env.local (or in the deploy environment). " +
        "Get a free key at https://hub.uniswap.org."
    );
  }
  return key;
}

function headers(): HeadersInit {
  return {
    "x-api-key": requireApiKey(),
    "content-type": "application/json",
    accept: "application/json",
  };
}

// ---------------------------------------------------------------------------
// API calls — small, focused, with consistent error reporting
// ---------------------------------------------------------------------------

async function postJson<T>(pathname: string, body: unknown): Promise<T> {
  const url = `${TRADE_API_BASE}${pathname}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(
      `UniswapX ${pathname} ${res.status}: ${text.slice(0, 400)}`
    );
  }
  return (await res.json()) as T;
}

async function getJson<T>(pathname: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${TRADE_API_BASE}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`UniswapX GET ${pathname} ${res.status}: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export function isChainSupported(chain: ChainId): boolean {
  return UNISWAPX_SUPPORTED_CHAINS.includes(chain);
}

export function reactorAddress(chain: ChainId): Address {
  const a = REACTORS[chain];
  if (!a) throw new Error(`UniswapX has no reactor configured for chain '${chain}'.`);
  return a;
}

/**
 * Get a UniswapX quote — for limit or market orders depending on the
 * routingPreference. The response includes the encoded order + EIP-712
 * typed data ready to sign.
 *
 * For a LIMIT ORDER specifically: pass routingPreference: "UNISWAPX_V2"
 * and use type: "EXACT_OUTPUT" to lock the desired output (i.e., "I want
 * to receive AT LEAST N USDC for my GRAY"). The API picks the LIMIT_ORDER
 * routing when the spec qualifies.
 */
export async function getQuote(args: QuoteRequest): Promise<QuoteResponse> {
  return postJson<QuoteResponse>("/quote", args);
}

/**
 * Sign the EIP-712 typed data inside a quote response. The Trade API
 * returns the typed data envelope in either `orderInfo` or `permitData`
 * (varies by routing); we sign whichever is present.
 */
export async function signQuote(
  quote: QuoteResponse["quote"],
  account: PrivateKeyAccount
): Promise<Hex> {
  const td = quote.orderInfo ?? quote.permitData;
  if (!td) {
    throw new Error(
      "Quote response had neither orderInfo nor permitData — Trade API shape " +
        "may have changed. Inspect the raw quote: " +
        JSON.stringify(quote).slice(0, 300)
    );
  }
  // The first key in `types` other than EIP712Domain is the primary type.
  const primaryType =
    Object.keys(td.types).find((k) => k !== "EIP712Domain") ?? "Order";
  // PrivateKeyAccount carries its own signTypedData — no need to thread
  // the raw private key through this module. viem handles the domain
  // separator + struct hashing per EIP-712.
  //
  // The cast through `unknown` is necessary because the Trade API's typed-
  // data envelope shape is opaque to TypeScript — viem's signTypedData is
  // strongly typed against a known schema, but ours is dynamic.
  return account.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType,
    message: td.values,
  } as unknown as Parameters<typeof account.signTypedData>[0]);
}

/**
 * Submit a signed UniswapX order. Returns the orderId for polling +
 * cancellation.
 */
export async function submitOrder(
  args: SubmitOrderRequest
): Promise<SubmitOrderResponse> {
  return postJson<SubmitOrderResponse>("/order", args);
}

/**
 * Fetch a single order's current status by orderId.
 */
export async function getStatus(orderId: string): Promise<OrderStatus> {
  return getJson<OrderStatus>("/orders", { orderId });
}

/**
 * List all orders signed by a given swapper address. Useful for the
 * `list_open_orders` MCP tool.
 */
export async function listOrders(args: {
  swapper: Address;
  /** Optional filter — "open" surfaces only unfilled orders. */
  orderStatus?: "open" | "filled" | "expired" | "cancelled";
  limit?: number;
}): Promise<{ orders: OrderStatus[] }> {
  const params: Record<string, string> = {
    swapper: args.swapper,
  };
  if (args.orderStatus) params.orderStatus = args.orderStatus;
  if (args.limit !== undefined) params.limit = String(args.limit);
  return getJson<{ orders: OrderStatus[] }>("/orders", params);
}

// ---------------------------------------------------------------------------
// High-level helpers — what the MCP tools actually call
// ---------------------------------------------------------------------------

/**
 * Full flow for a single limit order: quote → sign → submit. Returns the
 * orderId for tracking.
 *
 * For limit orders specifically, the caller should already have validated:
 *   - Wallet is unlocked + account is the right swapper
 *   - Balance covers the input amount
 *   - Chain is in UNISWAPX_SUPPORTED_CHAINS
 *   - User has approved the input token spend to Permit2 (the API will
 *     return an error with permit data if not — we propagate)
 */
export async function placeLimitOrder(args: {
  chain: ChainId;
  account: PrivateKeyAccount;
  tokenIn: Address;
  tokenOut: Address;
  /** Input amount in wei. */
  amountInWei: string;
  /** Minimum output amount in wei — the "limit price" floor. */
  minOutWei: string;
  /** Deadline in seconds-since-epoch. UniswapX limit orders cap at 30 days. */
  deadline: number;
}): Promise<{ orderId: string; routing: Routing; orderStatus: string }> {
  if (!isChainSupported(args.chain)) {
    throw new Error(`UniswapX not supported on chain '${args.chain}'.`);
  }
  const chainId = getChain(args.chain).numericId;

  // For an EXACT_INPUT limit order we send `amount` and target a minimum
  // output. The Trade API's quote endpoint returns a LIMIT_ORDER routing
  // when the user-specified output meets the limit shape.
  const quote = await getQuote({
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amount: args.amountInWei,
    type: "EXACT_INPUT",
    tokenInChainId: chainId,
    tokenOutChainId: chainId,
    swapper: args.account.address,
    routingPreference: "UNISWAPX_V2",
    deadline: args.deadline,
    // Lock the minimum output — drives the price selection on the API side.
    // (The API also accepts `slippageTolerance`; for limit orders, the
    // minOut + deadline are the binding constraints.)
    minAmountOut: args.minOutWei,
  });

  const signature = await signQuote(quote.quote, args.account);
  const submitted = await submitOrder({
    signature,
    quote: quote.quote,
    routing: quote.routing,
  });

  return {
    orderId: submitted.orderId,
    routing: quote.routing,
    orderStatus: submitted.orderStatus,
  };
}

/**
 * TWAP — Mode A (submit-all-now). Splits `totalInWei` into `chunks` equal
 * limit orders priced at submission-time market (with optional `priceOffsetBps`
 * to bias slightly above/below market), each with a staggered deadline so
 * fillers can pick them up across the window.
 *
 * Returns an array of child order results — caller writes them as a single
 * twap_order journal entry with `child_orders: [orderId1, orderId2, ...]`.
 *
 * Honesty: this is the same pattern the Uniswap UI uses for TWAP. It's
 * batched limit orders, not on-chain continuous execution. If the market
 * moves a lot during the window, some chunks may not fill — that's the
 * tradeoff. Mode B (submit-on-schedule, with fresh quotes per chunk) is
 * a future enhancement that needs background scheduling infra.
 */
export async function placeTwapOrder(args: {
  chain: ChainId;
  account: PrivateKeyAccount;
  tokenIn: Address;
  tokenOut: Address;
  /** Total input amount in wei. Split evenly across `chunks`. */
  totalInWei: string;
  chunks: number;
  /** Spacing between deadlines, in seconds. Each chunk deadline =
   *  baseDeadline + (i * intervalSeconds). */
  intervalSeconds: number;
  /** Base deadline for the FIRST chunk. */
  baseDeadlineSeconds: number;
  /** Minimum output per chunk (wei). Sets the per-chunk price floor. */
  minOutPerChunkWei: string;
}): Promise<{
  child_orders: Array<{
    orderId: string;
    routing: Routing;
    orderStatus: string;
    chunk_index: number;
    deadline: number;
    amount_in_wei: string;
  }>;
}> {
  if (args.chunks < 2) throw new Error("TWAP must have at least 2 chunks.");
  if (args.chunks > 50) throw new Error("TWAP cap is 50 chunks.");
  if (args.intervalSeconds < 30) throw new Error("TWAP interval must be ≥30s.");

  const perChunkIn = (BigInt(args.totalInWei) / BigInt(args.chunks)).toString();
  // Any remainder (from non-divisible totals) goes onto the last chunk so
  // the user's full balance gets accounted for.
  const remainder = BigInt(args.totalInWei) % BigInt(args.chunks);
  const lastChunkIn = (BigInt(perChunkIn) + remainder).toString();

  const results: Array<{
    orderId: string;
    routing: Routing;
    orderStatus: string;
    chunk_index: number;
    deadline: number;
    amount_in_wei: string;
  }> = [];

  for (let i = 0; i < args.chunks; i++) {
    const isLast = i === args.chunks - 1;
    const amountIn = isLast ? lastChunkIn : perChunkIn;
    const deadline = args.baseDeadlineSeconds + i * args.intervalSeconds;
    const r = await placeLimitOrder({
      chain: args.chain,
      account: args.account,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountInWei: amountIn,
      minOutWei: args.minOutPerChunkWei,
      deadline,
    });
    results.push({
      orderId: r.orderId,
      routing: r.routing,
      orderStatus: r.orderStatus,
      chunk_index: i,
      deadline,
      amount_in_wei: amountIn,
    });
  }

  return { child_orders: results };
}
