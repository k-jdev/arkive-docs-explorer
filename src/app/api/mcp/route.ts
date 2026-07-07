// MCP endpoint — Streamable HTTP transport, per the official MCP spec.
//
// We use the SDK's WebStandardStreamableHTTPServerTransport (designed for
// Node 18+ Web-Standard Request/Response, perfect for Next.js App Router).
// Our old hand-rolled HttpJsonRpcTransport only handled POST→JSON; Claude.ai
// and Claude Desktop probe with GET (expecting SSE) and DELETE (session
// termination), and treated the wrong content-type as "no MCP here" —
// surfacing as a 404 in the connector UI.
//
// Auth and per-user scoping are layered around the transport:
//   1. Resolve the bearer token (x-arkive-token OR Authorization: Bearer …)
//      to a user_id via mcp_tokens.
//   2. Run the entire transport.handleRequest inside withMcpUser(userId, …)
//      so AsyncLocalStorage propagates the user_id into every storage call
//      reached by the dispatched JSON-RPC handlers.
//
// We run stateless: sessionIdGenerator: undefined. Vercel serverless
// invocations don't persist state between requests, so trying to maintain
// session state in-process is misleading. The MCP client treats stateless
// servers fine — each request is self-contained.

import { buildArkiveMcp } from "@/lib/mcp-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveMcpToken } from "@/lib/mcp-tokens";
import { resolveAccessToken } from "@/lib/oauth";
import { withMcpUser } from "@/lib/request-context";

// Node runtime: we use crypto + fs + viem RPC + AsyncLocalStorage downstream.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CORS — Claude.ai's web client is cross-origin to arkive-ruby.vercel.app.
// Without these the browser blocks the connector entirely.
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, x-arkive-token, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
};

function extractBearer(req: Request): string | null {
  return (
    req.headers.get("x-arkive-token") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null
  );
}

/**
 * Build the WWW-Authenticate header that tells unauthenticated clients where to
 * discover our OAuth flow. claude.ai/Claude Desktop look for this on 401s and
 * walk the discovery chain (RFC 9728 → RFC 8414 → DCR → authorize → token).
 */
function wwwAuthenticate(req: Request): Record<string, string> {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "localhost:3000";
  const resourceMetadata = `${proto}://${host}/.well-known/oauth-protected-resource`;
  return {
    "www-authenticate": `Bearer realm="arkive-mcp", resource_metadata="${resourceMetadata}"`,
  };
}

/**
 * Resolve the bearer to a user_id. Accepts both:
 *   - arka_… OAuth access tokens (from /api/oauth/token, used by claude.ai)
 *   - arkv_… personal MCP tokens (from /api/auth/mcp-token, used by CLI/Desktop)
 *   - The legacy ARKIVE_MCP_TOKEN env var (filesystem backend, single-user).
 */
async function authenticate(req: Request): Promise<string | Response> {
  const backend = (process.env.STORAGE_BACKEND ?? "filesystem").toLowerCase();
  const provided = extractBearer(req);

  if (backend === "postgres") {
    if (!provided) {
      return new Response(
        "Authentication required. Either add this server as a custom OAuth connector in Claude.ai " +
          "(it will discover the auth flow automatically) OR generate a personal token at /connect " +
          "and pass it as `Authorization: Bearer …` / `x-arkive-token: …`.",
        { status: 401, headers: { ...CORS_HEADERS, ...wwwAuthenticate(req) } }
      );
    }

    // Try OAuth token first (arka_…), then personal token (arkv_…).
    const oauth = await resolveAccessToken(provided);
    if (oauth) return oauth.userId;
    const personal = await resolveMcpToken(provided);
    if (personal) return personal.userId;

    return new Response("Invalid or expired token", {
      status: 401,
      headers: { ...CORS_HEADERS, ...wwwAuthenticate(req) },
    });
  }

  // filesystem backend — legacy single-user mode
  const required = process.env.ARKIVE_MCP_TOKEN;
  if (required && provided !== required) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }
  return "_local";
}

/** Add CORS headers to whatever Response the transport produced. */
function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Build server + transport + delegate. Used by GET, POST, DELETE — the transport
 * itself routes by method. */
async function handle(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  return withMcpUser(userId, async () => {
    const server = buildArkiveMcp();
    const transport = new WebStandardStreamableHTTPServerTransport({
      // Stateless — each request is independent. Avoids per-instance session
      // state on Vercel serverless where requests can hit different lambdas.
      sessionIdGenerator: undefined,
      // Prefer plain JSON responses where SSE isn't required — simpler for
      // synchronous tool calls. SSE still kicks in for streaming responses.
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const res = await transport.handleRequest(req);
      return withCors(res);
    } finally {
      await server.close().catch(() => {});
    }
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}
