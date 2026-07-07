// OAuth 2.0 authorization endpoint (RFC 6749 §3.1, RFC 7636 PKCE).
//
// GET — validates the request, then either:
//   - redirects to /auth/sign-in if no SIWE session (with ?next pointing back here), or
//   - renders the consent page (signed-in user can Allow or Deny)
// POST — consume the consent decision, mint the auth code, 302 to redirect_uri.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { getClient, issueAuthCode } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AuthorizeParamsSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string(),
  redirect_uri: z.string().url(),
  code_challenge: z.string(),
  code_challenge_method: z.literal("S256"),
  scope: z.string().optional(),
  state: z.string().optional(),
});

type AuthorizeParams = z.infer<typeof AuthorizeParamsSchema>;

function readParams(req: NextRequest): { ok: true; params: AuthorizeParams } | { ok: false; html: string } {
  const raw = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = AuthorizeParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, html: errorPage("invalid_request", parsed.error.message) };
  }
  return { ok: true, params: parsed.data };
}

export async function GET(req: NextRequest) {
  const r = readParams(req);
  if (!r.ok) return htmlResponse(r.html, 400);

  // Client must be registered with this exact redirect_uri.
  const client = await getClient(r.params.client_id);
  if (!client) return htmlResponse(errorPage("invalid_client", "Unknown client_id"), 400);
  if (!client.redirectUris.includes(r.params.redirect_uri)) {
    return htmlResponse(
      errorPage(
        "invalid_redirect_uri",
        `Redirect URI not registered for this client. Expected one of: ${client.redirectUris.join(", ")}`
      ),
      400
    );
  }

  // Require the user to be signed in.
  const session = await getSession();
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.search = "";
    url.searchParams.set("next", `/api/oauth/authorize?${req.nextUrl.searchParams.toString()}`);
    return NextResponse.redirect(url);
  }

  // Show the consent page.
  return htmlResponse(
    consentPage({
      client,
      params: r.params,
      userLabel: session.displayName ?? session.walletAddress,
    }),
    200
  );
}

export async function POST(req: NextRequest) {
  const r = readParams(req);
  if (!r.ok) return htmlResponse(r.html, 400);

  const client = await getClient(r.params.client_id);
  if (!client) return htmlResponse(errorPage("invalid_client", "Unknown client_id"), 400);
  if (!client.redirectUris.includes(r.params.redirect_uri)) {
    return htmlResponse(errorPage("invalid_redirect_uri", "Redirect URI not registered"), 400);
  }

  const session = await getSession();
  if (!session) return htmlResponse(errorPage("login_required", "Sign in before authorizing"), 401);

  const form = await req.formData().catch(() => null);
  const decision = form?.get("decision");

  if (decision !== "allow") {
    // User declined — redirect with error per OAuth spec.
    const url = new URL(r.params.redirect_uri);
    url.searchParams.set("error", "access_denied");
    if (r.params.state) url.searchParams.set("state", r.params.state);
    // Status 303 forces the browser to convert the consent POST into a GET on
    // the client's callback URL (callbacks like claude.ai's only accept GET).
    // Next's default of 307 preserves method — would POST to the callback and 405.
    return NextResponse.redirect(url, 303);
  }

  const code = await issueAuthCode({
    clientId: r.params.client_id,
    userId: session.userId,
    redirectUri: r.params.redirect_uri,
    codeChallenge: r.params.code_challenge,
    scope: r.params.scope ?? null,
  });

  const url = new URL(r.params.redirect_uri);
  url.searchParams.set("code", code);
  if (r.params.state) url.searchParams.set("state", r.params.state);
  return NextResponse.redirect(url, 303);
}

// ============================================================================
// HTML — kept inline to avoid pulling these into the client bundle. Renders
// with the brand tokens via the existing stylesheet (globals.css is auto-loaded
// by Next App Router when reached via a layout, but this is a route handler
// returning raw HTML — so we inline the minimum styles).
// ============================================================================

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} — Arkive</title>
<style>
  :root {
    --bg: #0A0A0A; --fg: #F2F2F2; --card: #171717; --border: #2A2A2A;
    --muted: #B4B4B4; --primary: #2E68F4; --danger: #F43F5E; --radius: 7px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--fg);
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
         display: grid; place-items: center; padding: 24px; }
  .card { width: 100%; max-width: 480px; background: var(--card);
          border: 1px solid var(--border); border-radius: var(--radius); padding: 28px; }
  h1 { font-size: 22px; margin: 0 0 6px; font-weight: 600; letter-spacing: -0.01em; }
  p { color: var(--muted); margin: 0 0 14px; font-size: 14px; }
  .row { display: flex; gap: 8px; margin-top: 18px; }
  .btn { flex: 1; height: 38px; border-radius: var(--radius); border: 1px solid var(--border);
         background: var(--card); color: var(--fg); font: inherit; font-weight: 500; cursor: pointer; }
  .btn-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
  .btn-primary:hover { background: #2856c8; }
  .btn:hover { background: #222; }
  .panel { background: #0F0F0F; border: 1px solid var(--border); border-radius: var(--radius);
           padding: 12px; font-size: 13px; color: var(--muted); }
  .panel b { color: var(--fg); font-weight: 500; }
  .small { font-size: 12px; color: var(--muted); margin-top: 14px; }
  code { background: #0F0F0F; padding: 2px 6px; border-radius: 4px; font-size: 12px;
         font-family: ui-monospace, "JetBrains Mono", monospace; word-break: break-all; }
  .err { color: var(--danger); }
</style>
</head>
<body>${body}</body>
</html>`;
}

function consentPage({
  client,
  params,
  userLabel,
}: {
  client: { clientId: string; clientName: string | null };
  params: AuthorizeParams;
  userLabel: string;
}): string {
  const display = client.clientName || client.clientId;
  const truncatedUser = userLabel.length > 20 ? `${userLabel.slice(0, 8)}…${userLabel.slice(-6)}` : userLabel;
  const query = new URLSearchParams({
    response_type: params.response_type,
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    ...(params.scope ? { scope: params.scope } : {}),
    ...(params.state ? { state: params.state } : {}),
  }).toString();
  return shell(
    "Authorize",
    `
    <div class="card">
      <h1>Authorize ${escape(display)}</h1>
      <p>This client wants to access your Arkive data on your behalf.</p>
      <div class="panel">
        <div>Signed in as <b>${escape(truncatedUser)}</b></div>
        <div style="margin-top:8px">Redirect after consent: <code>${escape(params.redirect_uri)}</code></div>
      </div>
      <p class="small">If approved, ${escape(display)} can call any of your Arkive MCP tools —
      including signing-protected actions, which still require your explicit click on /pending.</p>
      <form method="POST" action="/api/oauth/authorize?${escape(query)}" class="row">
        <button class="btn" name="decision" value="deny" type="submit">Deny</button>
        <button class="btn btn-primary" name="decision" value="allow" type="submit" autofocus>Allow</button>
      </form>
    </div>`
  );
}

function errorPage(code: string, description: string): string {
  return shell(
    "Authorization error",
    `<div class="card">
      <h1 class="err">${escape(code)}</h1>
      <p>${escape(description)}</p>
    </div>`
  );
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
