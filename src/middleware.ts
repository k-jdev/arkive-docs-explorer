// Gate every route behind our own session cookie (set after SIWE verification).
// The middleware itself doesn't validate the cookie — it just checks for presence and
// redirects to /auth/sign-in if missing. Full session resolution happens in route
// handlers via getSession() which hits Postgres.
//
// Why presence-only here? Postgres queries inside middleware (Edge runtime) are tricky;
// keeping middleware Node-runtime would defeat the point. Checking presence is enough to
// gate page navigation. Invalid/expired cookies get cleaned up the next time a route
// handler reads getSession().

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "arkive_session";

const PUBLIC_PATHS = [
  "/auth",            // /auth/sign-in, /auth/sign-out
  "/api/auth",        // /api/auth/siwe/*  (note: /api/auth/mcp-token still requires session — checked in handler)
  "/api/mcp",         // MCP endpoint (gated by OAuth or personal bearer token in the route)
  "/api/storage-import", // legacy, token-gated
  "/api/oauth",       // /api/oauth/register, /authorize, /token — gated per-handler. authorize self-redirects to sign-in.
  "/.well-known",     // RFC 9728 / RFC 8414 metadata endpoints (must be CORS-public for client discovery)
];

const PUBLIC_FILE = /\.(svg|png|jpg|jpeg|gif|webp|ico|js|css|woff|woff2|map)$/;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/_next") || PUBLIC_FILE.test(pathname)) {
    return NextResponse.next();
  }

  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  const hasSession = Boolean(sessionToken);

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/arkives";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
