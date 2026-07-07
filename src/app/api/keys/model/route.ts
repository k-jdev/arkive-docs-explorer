// Model provider key management (session-gated).
//
//   GET    → list this user's stored model keys (masked: provider, hint,
//            label, isActive, runnable). Plus the catalog of providers.
//   POST   → add/replace a key. Body: { provider, key, label?, makeActive? }
//            OR set the active provider: { provider, setActive: true } (no key).
//   DELETE → remove a provider's key. Query: ?provider=<provider>.
//
// These keys feed the autonomous Daydream loop — see src/lib/model/index.ts
// (getModelClientForUser). The plaintext is never returned by GET.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import {
  MODEL_PROVIDERS,
  RUNNABLE_PROVIDERS,
  isModelProvider,
  listModelKeys,
  setModelKey,
  setActiveProvider,
  deleteModelKey,
} from "@/lib/model-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const keys = await listModelKeys(session.userId);
    return NextResponse.json({
      keys,
      providers: MODEL_PROVIDERS,
      runnable: RUNNABLE_PROVIDERS,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const PostSchema = z.object({
  provider: z.string(),
  key: z.string().min(8).max(400).optional(),
  label: z.string().max(80).optional(),
  makeActive: z.boolean().optional(),
  setActive: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!isModelProvider(body.provider)) {
    return NextResponse.json(
      { error: `Unknown provider '${body.provider}'. Allowed: ${MODEL_PROVIDERS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    // Mode 1: flip the active provider (no new key).
    if (body.setActive && !body.key) {
      const ok = await setActiveProvider({ userId: session.userId, provider: body.provider });
      if (!ok) return NextResponse.json({ error: "No stored key for that provider" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    // Mode 2: store/replace a key.
    if (!body.key) {
      return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }
    await setModelKey({
      userId: session.userId,
      provider: body.provider,
      key: body.key,
      label: body.label ?? null,
      makeActive: body.makeActive ?? body.setActive ?? false,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const provider = req.nextUrl.searchParams.get("provider");
  if (!provider || !isModelProvider(provider)) {
    return NextResponse.json({ error: "Missing or invalid ?provider=" }, { status: 400 });
  }
  try {
    const ok = await deleteModelKey({ userId: session.userId, provider });
    if (!ok) return NextResponse.json({ error: "No key for that provider" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
