// First-time data claim: re-assigns every "_local" arkive entry + keystore to the
// authenticated user.
//
// Conflict policy: if the authenticated user already has a row at the same
// (user_id, path), the _local row wins — we delete the destination first then
// reassign. This matches user intent: _local came from their imported snapshot
// and is the canonical data; anything that materialized under the new user_id
// before claim is presumed to be empty/default state.
//
// GET  → diagnostic: counts at _local, counts at new user, list of conflicting paths.
//        Read-only, safe to call any time.
// POST → perform the claim transactionally. Idempotent (running again is a no-op
//        because nothing remains at _local).
//
// Only valid against postgres backend.

import { NextResponse, type NextRequest } from "next/server";
import postgres from "postgres";
import { getSession } from "@/lib/session";

function pgClient() {
  return postgres(process.env.DATABASE_URL!, { ssl: "require", prepare: false, max: 1 });
}

function backendOk() {
  const backend = (process.env.STORAGE_BACKEND ?? "filesystem").toLowerCase();
  return backend === "postgres";
}

export async function GET(_req: NextRequest) {
  if (!backendOk()) {
    return NextResponse.json({ error: "Claim only runs against postgres backend" }, { status: 400 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sql = pgClient();
  try {
    const [localEntries] = await sql<Array<{ count: string }>>`
      SELECT count(*)::text FROM arkive_entries WHERE user_id = '_local'
    `;
    const [destEntries] = await sql<Array<{ count: string }>>`
      SELECT count(*)::text FROM arkive_entries WHERE user_id = ${session.userId}
    `;
    const conflicts = await sql<Array<{ path: string }>>`
      SELECT a.path FROM arkive_entries a
      WHERE a.user_id = '_local'
        AND EXISTS (
          SELECT 1 FROM arkive_entries b
          WHERE b.user_id = ${session.userId} AND b.path = a.path
        )
    `;
    const [localKeystore] = await sql<Array<{ count: string }>>`
      SELECT count(*)::text FROM keystores WHERE user_id = '_local'
    `;
    const [destKeystore] = await sql<Array<{ count: string }>>`
      SELECT count(*)::text FROM keystores WHERE user_id = ${session.userId}
    `;
    return NextResponse.json({
      userId: session.userId,
      walletAddress: session.walletAddress,
      arkiveEntries: {
        atLocal: Number(localEntries.count),
        atUser: Number(destEntries.count),
        conflictingPaths: conflicts.map((r) => r.path),
      },
      keystores: {
        atLocal: Number(localKeystore.count),
        atUser: Number(destKeystore.count),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    await sql.end();
  }
}

export async function POST(_req: NextRequest) {
  if (!backendOk()) {
    return NextResponse.json({ error: "Claim only runs against postgres backend" }, { status: 400 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sql = pgClient();
  try {
    const result = await sql.begin(async (tx) => {
      // 1. arkive_entries: drop dest rows that collide with _local rows, then reassign.
      const dropped = await tx`
        DELETE FROM arkive_entries dst
        WHERE dst.user_id = ${session.userId}
          AND EXISTS (
            SELECT 1 FROM arkive_entries src
            WHERE src.user_id = '_local' AND src.path = dst.path
          )
      `;
      const movedEntries = await tx`
        UPDATE arkive_entries SET user_id = ${session.userId} WHERE user_id = '_local'
      `;

      // 2. keystores: PK is user_id alone, so if dest row exists we must drop it first.
      // We prefer _local because that's the imported snapshot of the user's wallets.
      const droppedKeystore = await tx`
        DELETE FROM keystores WHERE user_id = ${session.userId}
          AND EXISTS (SELECT 1 FROM keystores WHERE user_id = '_local')
      `;
      const movedKeystore = await tx`
        UPDATE keystores SET user_id = ${session.userId} WHERE user_id = '_local'
      `;

      return {
        droppedEntryConflicts: dropped.count,
        reassignedEntries: movedEntries.count,
        droppedKeystoreConflict: droppedKeystore.count,
        reassignedKeystores: movedKeystore.count,
      };
    });

    return NextResponse.json({
      ok: true,
      userId: session.userId,
      walletAddress: session.walletAddress,
      ...result,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, stack: (e as Error).stack }, { status: 500 });
  } finally {
    await sql.end();
  }
}
