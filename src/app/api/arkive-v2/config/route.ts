// GET/POST /api/arkive-v2/config — read or update arkive.config defaults.
//
// CP4 needs a way for the UI to read + set daydream_frequency. No config
// HTTP route existed (only the lib helpers readArkiveConfig/writeArkiveConfig),
// so this adds one, following the arkive-v2 pattern: session-gated, and
// user-scoped via the storage adapter inside read/writeArkiveConfig
// (currentUserId). Today it exposes the whole config on GET and accepts a
// daydream_frequency update on POST; it's intentionally narrow — it does not
// let the UI rewrite arbitrary config (the engine owns the rest).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { readArkiveConfig, writeArkiveConfig } from "@/lib/arkive-v2/arkive-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const cfg = await readArkiveConfig();
    return NextResponse.json({ config: cfg });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const PostSchema = z.object({
  daydream_frequency: z.enum(["off", "daily", "frequent"]),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  try {
    const cfg = await readArkiveConfig();
    cfg.defaults.daydream_frequency = body.daydream_frequency;
    await writeArkiveConfig(cfg);
    return NextResponse.json({ ok: true, daydream_frequency: cfg.defaults.daydream_frequency });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
