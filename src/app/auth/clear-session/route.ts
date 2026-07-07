// GET /auth/clear-session — clears the arkive_session cookie and redirects
// to /auth/sign-in. Used when a stale cookie needs to be removed but the
// caller is a server component (which can't set cookies in Next 15).

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jar = await cookies();
  jar.set("arkive_session", "", { path: "/", expires: new Date(0) });
  const url = req.nextUrl.clone();
  url.pathname = "/auth/sign-in";
  url.search = "";
  return NextResponse.redirect(url, { status: 302 });
}
