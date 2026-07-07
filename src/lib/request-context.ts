// Per-request user context for code paths that don't have access to cookies.
//
// The MCP route authenticates via a bearer token (per-user mcp_tokens row), then
// runs the JSON-RPC dispatch inside `mcpUserContext.run(userId, fn)`. Anything
// that calls currentUserId() while inside that callback gets the resolved id
// without having to thread it through every function signature.
//
// AsyncLocalStorage is the Node-native way to do this — Next.js Node-runtime
// route handlers preserve the context across awaits.

import { AsyncLocalStorage } from "node:async_hooks";

type Ctx = {
  userId: string;
  source: "mcp-token";
};

const _store = new AsyncLocalStorage<Ctx>();

export function withMcpUser<T>(userId: string, fn: () => Promise<T> | T): Promise<T> | T {
  return _store.run({ userId, source: "mcp-token" }, fn);
}

/** Returns the user id of the current request, if one was bound via withMcpUser. */
export function currentRequestUserId(): string | null {
  return _store.getStore()?.userId ?? null;
}
