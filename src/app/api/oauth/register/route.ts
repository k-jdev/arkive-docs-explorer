// Dynamic Client Registration (RFC 7591).
//
// claude.ai (and any MCP client) POSTs here on first connect with at minimum
// `redirect_uris`. We mint a `client_id` and return it. We don't issue a
// `client_secret` — we're a public-client-only authorization server (PKCE
// gives us the security).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { registerClient } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const RegisterSchema = z.object({
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  // Other RFC 7591 fields are accepted but ignored.
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET, POST, OPTIONS" } });
}

/**
 * Some OAuth clients (including Anthropic's MCP connector backend) probe
 * endpoints with GET first to verify they exist before issuing the real
 * request. Returning 405 here breaks the connector setup. We return a small
 * descriptor so the probe succeeds; the real flow uses POST.
 */
export async function GET() {
  return NextResponse.json(
    {
      endpoint: "registration",
      method: "POST",
      required: ["redirect_uris"],
      optional: ["client_name"],
      content_type: "application/json",
      note: "Send a POST with JSON body to register a new client per RFC 7591.",
    },
    { status: 200, headers: { ...CORS, "access-control-allow-methods": "GET, POST, OPTIONS" } }
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "Body must be JSON" }, { status: 400, headers: CORS });
  }
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: parsed.error.message },
      { status: 400, headers: CORS }
    );
  }
  try {
    const client = await registerClient({
      clientName: parsed.data.client_name,
      redirectUris: parsed.data.redirect_uris,
    });
    return NextResponse.json(
      {
        client_id: client.clientId,
        // Public client — no secret. PKCE is mandatory.
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { status: 201, headers: CORS }
    );
  } catch (e) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: (e as Error).message },
      { status: 400, headers: CORS }
    );
  }
}
