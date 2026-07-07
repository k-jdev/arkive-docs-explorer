"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SiweMessage } from "siwe";
import { getAddress } from "viem";
import { ArkiveMark } from "@/components/ArkiveLogo";

type EthRequest = (args: { method: string; params?: unknown[] }) => Promise<unknown>;
type Eip1193 = { request: EthRequest; on?: (event: string, handler: (...args: unknown[]) => void) => void };
declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [hasInjected, setHasInjected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [step, setStep] = useState<"connect" | "sign" | "verifying">("connect");
  const [error, setError] = useState<string | null>(params.get("error"));

  // Alternate login: a key string (created on the Keys page while signed in via
  // wallet) lets the user sign in without a wallet signature.
  const [mode, setMode] = useState<"wallet" | "key">("wallet");
  const [loginKey, setLoginKey] = useState("");
  const [keySubmitting, setKeySubmitting] = useState(false);

  async function signInWithKey() {
    if (!loginKey.trim()) return;
    setError(null);
    setKeySubmitting(true);
    try {
      const res = await fetch("/api/auth/login-key/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: loginKey.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Sign-in failed: ${res.status}`);
      router.push(next);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setKeySubmitting(false);
    }
  }

  useEffect(() => {
    setHasInjected(typeof window !== "undefined" && Boolean(window.ethereum));
  }, []);

  async function connect() {
    setError(null);
    if (!window.ethereum) {
      setError("No wallet detected. Install MetaMask or open this page in your wallet's browser.");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accounts?.[0];
      if (!addr) throw new Error("No account returned by wallet");
      const cid = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      // SIWE requires EIP-55 checksum format. MetaMask returns lowercase from eth_requestAccounts.
      setAddress(getAddress(addr));
      setChainId(parseInt(cid, 16));
      setStep("sign");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg.toLowerCase().includes("reject") ? "You declined the connection." : msg);
    }
  }

  async function signIn() {
    if (!address || !chainId || !window.ethereum) return;
    setError(null);
    setStep("verifying");
    try {
      const nonceRes = await fetch("/api/auth/siwe/nonce");
      if (!nonceRes.ok) throw new Error(`Nonce fetch failed: ${nonceRes.status}`);
      const { nonce, signature: nonceSignature } = (await nonceRes.json()) as {
        nonce: string;
        signature: string;
      };

      const siwe = new SiweMessage({
        domain: window.location.host,
        address,
        statement:
          "Sign in to Arkive. By signing you authorize this browser to access your Arkive account. No transaction is created.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce,
        issuedAt: new Date().toISOString(),
      });
      const message = siwe.prepareMessage();

      const sig = (await window.ethereum.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;

      const verifyRes = await fetch("/api/auth/siwe/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature: sig, nonceSignature }),
      });
      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        throw new Error(body?.error ?? `Verify failed: ${verifyRes.status}`);
      }

      router.push(next);
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg.toLowerCase().includes("reject") ? "You declined the signature. Try again to sign in." : msg);
      setStep("sign");
    }
  }

  return (
    <div className="bg-arkive-hero flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <ArkiveMark size={48} priority />
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              Sign in to Arkive
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Your wallet, your trades, your second brain.
            </p>
          </div>
        </div>

        {step === "connect" && mode === "wallet" && (
          <>
            {/*
              The button is ALWAYS clickable. We used to disable it until
              `hasInjected` flipped true client-side, which led to a "button
              looks dead" experience on the server-rendered shell (and
              permanently dead if hydration failed for any reason).
              Now clicking with no wallet just surfaces the helpful error
              via connect()'s no-wallet branch.
            */}
            <button
              onClick={connect}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors duration-120 hover:bg-primary/90"
            >
              <WalletIcon />
              Connect wallet
            </button>
            {/* Hint stays — useful for users without an injected wallet — but
                we only show it after the client confirms no wallet is present,
                so users on Brave/MM mobile don't see a phantom warning. */}
            {hasInjected === false && typeof window !== "undefined" && !window.ethereum && (
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                No injected wallet detected. Install{" "}
                <a className="underline underline-offset-2" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                  MetaMask
                </a>{" "}
                or open this page inside your wallet's built-in browser.
              </p>
            )}
            <button
              onClick={() => {
                setMode("key");
                setError(null);
              }}
              className="mt-3 block w-full text-center text-xs text-muted-foreground transition-colors duration-120 hover:text-foreground"
            >
              Sign in with a login key instead
            </button>
          </>
        )}

        {step === "connect" && mode === "key" && (
          <div className="space-y-3">
            <label className="block">
              <span className="font-code text-2xs uppercase tracking-[0.06em] text-muted-foreground">
                Login key
              </span>
              <input
                type="password"
                value={loginKey}
                onChange={(e) => setLoginKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") signInWithKey();
                }}
                placeholder="arklogin_…"
                autoComplete="off"
                className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 font-code text-xs text-foreground outline-none transition-colors focus:border-primary/60"
              />
            </label>
            <button
              onClick={signInWithKey}
              disabled={keySubmitting || !loginKey.trim()}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors duration-120 hover:bg-primary/90 disabled:opacity-50"
            >
              {keySubmitting ? <Spinner /> : <SignIcon />}
              {keySubmitting ? "Signing in…" : "Sign in with key"}
            </button>
            <button
              onClick={() => {
                setMode("wallet");
                setLoginKey("");
                setError(null);
              }}
              className="block w-full text-center text-xs text-muted-foreground transition-colors duration-120 hover:text-foreground"
            >
              ← Use my wallet instead
            </button>
          </div>
        )}

        {(step === "sign" || step === "verifying") && address && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-sm">
              <div className="font-code text-2xs uppercase tracking-[0.06em] text-muted-foreground">
                Connected
              </div>
              <div className="mt-1 text-xs tabular-nums text-foreground">{address}</div>
            </div>
            <button
              onClick={signIn}
              disabled={step === "verifying"}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors duration-120 hover:bg-primary/90 disabled:opacity-50"
            >
              {step === "verifying" ? <Spinner /> : <SignIcon />}
              {step === "verifying" ? "Signing in…" : "Sign in"}
            </button>
            <button
              onClick={() => {
                setAddress(null);
                setChainId(null);
                setStep("connect");
                setError(null);
              }}
              className="block w-full text-center text-xs text-muted-foreground transition-colors duration-120 hover:text-foreground"
            >
              Use a different wallet
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Signing the message proves you control the address — no transaction, no gas. Your wallet's
          private key never leaves your wallet.
        </p>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 010-4h14v4" />
      <path d="M3 5v14a2 2 0 002 2h16v-5" />
      <path d="M18 12a2 2 0 100 4h4v-4z" />
    </svg>
  );
}

function SignIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
