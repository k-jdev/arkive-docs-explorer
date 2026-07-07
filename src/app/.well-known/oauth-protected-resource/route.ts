// Protected Resource Metadata (RFC 9728).
//
// When the MCP endpoint returns 401, it sets:
//   WWW-Authenticate: Bearer resource_metadata="<this URL>"
//
// The client (claude.ai etc.) fetches THIS document to learn which
// authorization servers it can use. We point at ourselves — we're both the
// protected resource and the authorization server.

import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function origin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function GET() {
  const base = await origin();
  return NextResponse.json(
    {
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      // Free-text — exposed in some client UIs.
      resource_documentation: `${base}/connect`,
    },
    {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=300",
      },
    }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
