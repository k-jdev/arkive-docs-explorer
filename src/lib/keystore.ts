import crypto from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex, PrivateKeyAccount } from "viem";
import { storage, currentUserId, type EncryptedKeystore } from "@/lib/storage";

// AES-256-GCM + PBKDF2-SHA256 (200k iterations)
const KDF_ITERS = 200_000;
const KDF_KEYLEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;

/**
 * Wallet kinds:
 *  - "owned": we have the encrypted private key. Can sign transactions.
 *  - "watch": address-only. Read tools work (balances, portfolio, holdings, arkive
 *    entries derived from chain data); write tools (swap, transfer, approve, LP,
 *    etc.) refuse with a clear error. Useful for tracking cold storage, friends'
 *    wallets, vault contracts you don't control.
 *
 * Older keystore rows lack the field — we treat them as "owned" (they have a cipher).
 */
export type WalletKind = "owned" | "watch";

export type StoredWallet = {
  id: string;
  address: `0x${string}`;
  label: string;
  createdAt: number;
  /** Optional discriminator. Absent = treat as "owned" for backward compat. */
  kind?: WalletKind;
  /** Optional free-form purpose: "hot trading", "cold storage", "memecoin gambling", etc. */
  purpose?: string;
  /** Optional tags for filtering/grouping. */
  tags?: string[];
  /** Present only for kind="owned". Absent on watch-only wallets. */
  cipher?: {
    salt: string; // base64
    iv: string; // base64
    ct: string; // base64 (ciphertext + auth tag concatenated)
  };
};

export type Keystore = {
  version: 1;
  wallets: StoredWallet[];
};

async function readKeystore(): Promise<Keystore> {
  const stored = (await storage().readKeystore(await currentUserId())) as EncryptedKeystore | null;
  if (!stored) return { version: 1, wallets: [] };
  // The on-disk format and our internal `Keystore` shape match — same fields.
  return { version: stored.version as 1, wallets: stored.wallets as StoredWallet[] };
}

async function writeKeystore(ks: Keystore): Promise<void> {
  await storage().writeKeystore(await currentUserId(), ks as EncryptedKeystore);
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, KDF_ITERS, KDF_KEYLEN, "sha256");
}

function encryptPrivateKey(privateKey: Hex, password: string): StoredWallet["cipher"] {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(privateKey.slice(2), "hex");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ct: Buffer.concat([ct, tag]).toString("base64"),
  };
}

function decryptPrivateKey(cipherObj: NonNullable<StoredWallet["cipher"]>, password: string): Hex {
  const salt = Buffer.from(cipherObj.salt, "base64");
  const iv = Buffer.from(cipherObj.iv, "base64");
  const blob = Buffer.from(cipherObj.ct, "base64");
  // Last 16 bytes are the GCM auth tag
  const ct = blob.subarray(0, blob.length - 16);
  const tag = blob.subarray(blob.length - 16);
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return ("0x" + pt.toString("hex")) as Hex;
}

/** Effective wallet kind — absent field treated as "owned" for backward compat. */
export function walletKind(w: Pick<StoredWallet, "kind" | "cipher">): WalletKind {
  if (w.kind) return w.kind;
  return w.cipher ? "owned" : "watch";
}

export async function listWallets(): Promise<
  Array<Pick<StoredWallet, "id" | "address" | "label" | "createdAt" | "purpose" | "tags"> & { kind: WalletKind }>
> {
  const ks = await readKeystore();
  return ks.wallets.map((w) => ({
    id: w.id,
    address: w.address,
    label: w.label,
    createdAt: w.createdAt,
    purpose: w.purpose,
    tags: w.tags,
    kind: walletKind(w),
  }));
}

export async function updateWalletMetadata(
  id: string,
  patch: { label?: string; purpose?: string; tags?: string[] }
): Promise<Pick<StoredWallet, "id" | "address" | "label" | "purpose" | "tags">> {
  const ks = await readKeystore();
  const w = ks.wallets.find((x) => x.id === id);
  if (!w) throw new Error(`Wallet not found: ${id}`);
  if (patch.label !== undefined) w.label = patch.label;
  if (patch.purpose !== undefined) w.purpose = patch.purpose;
  if (patch.tags !== undefined) w.tags = patch.tags;
  await writeKeystore(ks);
  return { id: w.id, address: w.address, label: w.label, purpose: w.purpose, tags: w.tags };
}

export async function createWallet(label: string, password: string): Promise<StoredWallet> {
  if (!password) throw new Error("Password required");
  const pk = generatePrivateKey();
  return persistNewWallet(pk, label, password);
}

/**
 * Add a watch-only wallet by address. No private key, no password — just the address.
 * Read tools will see it the same as an owned wallet; write tools refuse via
 * `requireOwnedWallet`. Arkive entries derived from this wallet's chain data are
 * tagged with `wallet_kind: "watch"` so they're clearly distinguishable later.
 */
export async function addWatchWallet(args: { address: string; label?: string }): Promise<StoredWallet> {
  const addr = args.address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error("Address must be 40 hex characters (with or without 0x — full Ethereum address)");
  }
  // Normalize to checksummed form via viem
  const { getAddress } = await import("viem");
  let checksummed: `0x${string}`;
  try {
    checksummed = getAddress(addr) as `0x${string}`;
  } catch {
    throw new Error("Invalid Ethereum address (bad checksum or malformed)");
  }

  const ks = await readKeystore();
  if (ks.wallets.some((w) => w.address.toLowerCase() === checksummed.toLowerCase())) {
    throw new Error("Wallet with this address already exists");
  }
  const wallet: StoredWallet = {
    id: crypto.randomUUID(),
    address: checksummed,
    label: args.label?.trim() || checksummed.slice(0, 8),
    createdAt: Date.now(),
    kind: "watch",
  };
  ks.wallets.push(wallet);
  await writeKeystore(ks);
  return wallet;
}

/**
 * Guard for write operations. Throws if the wallet is watch-only, otherwise returns
 * the wallet record. Use at the top of every MCP tool that signs a transaction.
 */
export async function requireOwnedWallet(id: string): Promise<StoredWallet> {
  const w = await getWalletById(id);
  if (!w) throw new Error(`Wallet not found: ${id}`);
  if (walletKind(w) === "watch") {
    throw new Error(
      `Wallet "${w.label}" is watch-only (address ${w.address.slice(0, 6)}…${w.address.slice(-4)}). ` +
        `Read tools work, but signing requires the private key. ` +
        `To enable signing, delete this wallet and re-add it via import_wallet with the PK.`
    );
  }
  return w;
}

export async function importWallet(privateKey: string, label: string, password: string): Promise<StoredWallet> {
  if (!password) throw new Error("Password required");
  const normalized = privateKey.trim().toLowerCase().startsWith("0x")
    ? (privateKey.trim() as Hex)
    : (`0x${privateKey.trim()}` as Hex);
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Private key must be 64 hex characters (with or without 0x)");
  }
  return persistNewWallet(normalized, label, password);
}

async function persistNewWallet(pk: Hex, label: string, password: string): Promise<StoredWallet> {
  const account = privateKeyToAccount(pk);
  const ks = await readKeystore();
  if (ks.wallets.some((w) => w.address.toLowerCase() === account.address.toLowerCase())) {
    throw new Error("Wallet with this address already exists");
  }
  const wallet: StoredWallet = {
    id: crypto.randomUUID(),
    address: account.address,
    label: label || account.address.slice(0, 8),
    createdAt: Date.now(),
    kind: "owned",
    cipher: encryptPrivateKey(pk, password),
  };
  ks.wallets.push(wallet);
  await writeKeystore(ks);
  return wallet;
}

export async function deleteWallet(id: string): Promise<void> {
  const ks = await readKeystore();
  ks.wallets = ks.wallets.filter((w) => w.id !== id);
  await writeKeystore(ks);
}

export async function unlockAccount(id: string, password: string): Promise<PrivateKeyAccount> {
  const ks = await readKeystore();
  const w = ks.wallets.find((x) => x.id === id);
  if (!w) throw new Error("Wallet not found");
  if (walletKind(w) === "watch" || !w.cipher) {
    throw new Error(`Wallet "${w.label}" is watch-only — no private key stored, cannot unlock.`);
  }
  let pk: Hex;
  try {
    pk = decryptPrivateKey(w.cipher, password);
  } catch {
    throw new Error("Incorrect password");
  }
  return privateKeyToAccount(pk);
}

export async function getWalletById(id: string): Promise<StoredWallet | undefined> {
  const ks = await readKeystore();
  return ks.wallets.find((w) => w.id === id);
}
