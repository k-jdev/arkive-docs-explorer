// One-shot data import.
//
// Two modes:
//   GET  — copies from filesystem → current storage backend (used only when both adapters
//          run on the same machine, e.g. local-to-local dev test). Returns 404 in production.
//   POST — accepts a JSON body matching the shape produced by scripts/export-local.mjs
//          and writes every entry + the keystore into the configured storage backend.
//          Token-gated by IMPORT_TOKEN env var. This is how local data lands on Vercel.
//
// After your data is imported, delete IMPORT_TOKEN from Vercel env (or set this route to
// always-404) so nobody can re-trigger it.

import { NextResponse } from "next/server";
import { storage, LOCAL_USER_ID } from "@/lib/storage";
import type { StoredEntry, EncryptedKeystore } from "@/lib/storage/types";

const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50MB — generous, our typical export is < 1MB

export async function GET() {
  // Filesystem-to-Postgres-on-same-host only made sense in local dev. On Vercel the
  // filesystem is empty so this is a no-op at best, a footgun at worst. Disabled.
  return NextResponse.json(
    { error: "Use POST with an arkive-export.json body. See scripts/export-local.mjs." },
    { status: 405 }
  );
}

export async function POST(req: Request) {
  const requiredToken = process.env.IMPORT_TOKEN;
  if (!requiredToken) {
    return NextResponse.json(
      { error: "Import disabled. Server has no IMPORT_TOKEN set." },
      { status: 403 }
    );
  }
  const url = new URL(req.url);
  const presented = url.searchParams.get("token") ?? req.headers.get("x-import-token");
  if (presented !== requiredToken) {
    return NextResponse.json({ error: "Bad or missing token." }, { status: 401 });
  }

  // Sanity-cap the body size
  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader && parseInt(lengthHeader, 10) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: `Body exceeds ${MAX_BODY_BYTES} bytes.` }, { status: 413 });
  }

  let payload: {
    exportedAt?: string;
    entries?: StoredEntry[];
    keystore?: EncryptedKeystore | null;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  const entries = payload.entries ?? [];
  const keystore = payload.keystore ?? null;
  const report: {
    importedEntries: number;
    importedKeystoreWallets: number;
    backend: string;
    errors: Array<{ path: string; error: string }>;
  } = {
    importedEntries: 0,
    importedKeystoreWallets: 0,
    backend: (process.env.STORAGE_BACKEND ?? "filesystem").toLowerCase(),
    errors: [],
  };

  const s = storage();
  for (const e of entries) {
    if (!e?.path || typeof e.path !== "string") {
      report.errors.push({ path: String(e?.path ?? "?"), error: "Missing or invalid path" });
      continue;
    }
    try {
      await s.writeEntry(LOCAL_USER_ID, {
        path: e.path,
        meta: e.meta ?? {},
        body: e.body ?? "",
      });
      report.importedEntries++;
    } catch (err) {
      report.errors.push({ path: e.path, error: (err as Error).message });
    }
  }

  if (keystore) {
    try {
      await s.writeKeystore(LOCAL_USER_ID, keystore);
      report.importedKeystoreWallets = keystore.wallets?.length ?? 0;
    } catch (err) {
      report.errors.push({ path: "<keystore>", error: (err as Error).message });
    }
  }

  return NextResponse.json({ ok: report.errors.length === 0, report });
}
