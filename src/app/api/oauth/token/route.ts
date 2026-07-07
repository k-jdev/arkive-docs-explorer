// OAuth 2.0 token endpoint.
//
// Two grant types:
//   - authorization_code: client exchanges the one-time code (from /authorize)
//     + a PKCE verifier for an access + refresh token pair.
//   - refresh_token: client rotates an old refresh token for a new pair.
//
// Public client only (token_endpoint_auth_method = "none"): we don't validate
// a client secret. PKCE replaces the secret as the proof of possession.

import { NextResponse, type NextRequest } from "next/server";
import {
  consumeAuthCode,
  getClient,
  issueAccessToken,
  rotateRefreshToken,
  verifyPkce,
} from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET, POST, OPTIONS" } });
}

/**
 * GET probe — return a small descriptor so clients (e.g. Anthropic's MCP
 * connector backend) that check endpoint existence with GET don't see a 405.
 */
export async function GET() {
  return NextResponse.json(
    {
      endpoint: "token",
      method: "POST",
      grant_types_supported: ["authorization_code", "refresh_token"],
      content_type: "application/x-www-form-urlencoded or application/json",
      note: "Send a POST per RFC 6749 §3.2 to exchange a code/refresh for tokens.",
    },
    { status: 200, headers: { ...CORS, "access-control-allow-methods": "GET, POST, OPTIONS" } }
  );
}

/**
 * Parse the body. RFC 6749 says token endpoint accepts
 * application/x-www-form-urlencoded; we also accept JSON for client convenience.
 */
async function parseBody(req: NextRequest): Promise<Record<string, string>> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, string>;
    return j ?? {};
  }
  const f = await req.formData().catch(() => null);
  if (!f) return {};
  const out: Record<string, string> = {};
  f.forEach((v, k) => {
    out[k] = typeof v === "string" ? v : "";
  });
  return out;
}

function err(code: string, description: string, status = 400) {
  return NextResponse.json({ error: code, error_description: description }, { status, headers: CORS });
}

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  const grant = body.grant_type;

  if (grant === "authorization_code") {
    const required = ["code", "client_id", "code_verifier", "redirect_uri"] as const;
    for (const k of required) {
      if (!body[k]) return err("invalid_request", `Missing ${k}`);
    }
    const code = await consumeAuthCode(body.code);
    if (!code) return err("invalid_grant", "Authorization code is invalid, expired, or already used");
    if (code.clientId !== body.client_id) return err("invalid_grant", "client_id mismatch");
    if (code.redirectUri !== body.redirect_uri) return err("invalid_grant", "redirect_uri mismatch");
    if (!verifyPkce(body.code_verifier, code.codeChallenge)) {
      return err("invalid_grant", "PKCE code_verifier does not match code_challenge");
    }
    const tokens = await issueAccessToken({
      clientId: code.clientId,
      userId: code.userId,
      scope: code.scope,
    });
    return NextResponse.json(
      {
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: code.scope ?? "mcp",
      },
      { status: 200, headers: CORS }
    );
  }

  if (grant === "refresh_token") {
    if (!body.refresh_token || !body.client_id) return err("invalid_request", "Missing refresh_token or client_id");
    const client = await getClient(body.client_id);
    if (!client) return err("invalid_client", "Unknown client_id");
    const tokens = await rotateRefreshToken({
      refreshToken: body.refresh_token,
      clientId: body.client_id,
    });
    if (!tokens) return err("invalid_grant", "Refresh token invalid or already used");
    return NextResponse.json(
      {
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: "mcp",
      },
      { status: 200, headers: CORS }
    );
  }

  return err("unsupported_grant_type", `Grant '${grant ?? ""}' is not supported`);
}
