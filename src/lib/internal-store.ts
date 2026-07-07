// Internal infrastructure store.
//
// Holds non-arkive persistence — trade records (for PnL math), user
// behavioral profile, and any other "the app needs to remember this"
// data that isn't part of the user-facing arkive substrate.
//
// All paths live under `_internal/*` so the arkives UI can filter them
// out cleanly: the user's `arkive/` directory stays pure v2 per the
// blueprint, and the underlying storage adapter handles the rest.
//
// Format: same as the v2 frontmatter writer — `---\n<yaml>\n---\n<body>`.
// Reads return { meta, body }. Writes serialize back through the codec.

import { storage, currentUserId } from "@/lib/storage";
import { parseFrontmatter, serializeEntry } from "@/lib/arkive-v2/frontmatter";

const PREFIX = "_internal";

export type InternalEntry<M = Record<string, unknown>> = {
  path: string;
  meta: M;
  body: string;
};

/** Build a fully-qualified internal path: `_internal/<namespace>/<id>`. */
export function internalPath(namespace: string, id: string): string {
  return `${PREFIX}/${namespace}/${id}`;
}

/** True if a path is in the internal namespace (filter for the arkives UI). */
export function isInternalPath(p: string): boolean {
  return p.startsWith(`${PREFIX}/`);
}

export async function readInternal<M = Record<string, unknown>>(
  namespace: string,
  id: string
): Promise<InternalEntry<M> | null> {
  const uid = await currentUserId();
  const path = internalPath(namespace, id);
  const entry = await storage().readEntry(uid, path);
  if (!entry) return null;
  const { meta, body } = parseFrontmatter<M>(entry.body);
  return { path, meta, body };
}

export async function writeInternal(args: {
  namespace: string;
  id: string;
  meta: Record<string, unknown>;
  body: string;
}): Promise<void> {
  const uid = await currentUserId();
  const path = internalPath(args.namespace, args.id);
  const text = serializeEntry(args.meta, args.body);
  await storage().writeEntry(uid, { path, body: text, meta: args.meta });
}

export async function listInternal<M = Record<string, unknown>>(
  namespace: string
): Promise<Array<InternalEntry<M>>> {
  const uid = await currentUserId();
  const prefix = `${PREFIX}/${namespace}/`;
  const all = await storage().listEntries(uid, prefix);
  return all.map((e) => {
    const { meta, body } = parseFrontmatter<M>(e.body);
    return { path: e.path, meta, body };
  });
}

export async function deleteInternal(namespace: string, id: string): Promise<boolean> {
  const uid = await currentUserId();
  const path = internalPath(namespace, id);
  return storage().deleteEntry(uid, path);
}
