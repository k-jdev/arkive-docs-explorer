import { getSession } from "@/lib/session";

/**
 * Sidebar footer — wallet identity + sign-out.
 *
 * Renders a compact row: deterministic gradient avatar, truncated address (or
 * display name), and a small sign-out link. Designed to live at the bottom of
 * the left sidebar in the (app) layout.
 *
 * On mobile (header), this still fits because the address is truncated.
 */
export async function AccountMenu() {
  const session = await getSession();
  if (!session) return null;

  const display = session.displayName ?? truncateAddr(session.walletAddress);

  return (
    <div className="flex items-center gap-2.5">
      {session.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={session.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full" />
      ) : (
        <div
          className="h-7 w-7 shrink-0 rounded-full"
          style={{ background: avatarColor(session.walletAddress) }}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium tabular-nums text-foreground">{display}</div>
        <a
          href="/auth/sign-out"
          className="text-xs text-muted-foreground transition-colors duration-120 hover:text-foreground"
        >
          Sign out
        </a>
      </div>
    </div>
  );
}

function truncateAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

/** Deterministic gradient avatar from address bytes — second stop is the brand primary. */
function avatarColor(addr: string): string {
  const bytes = addr.replace(/^0x/, "");
  const r = parseInt(bytes.slice(0, 2), 16);
  const g = parseInt(bytes.slice(2, 4), 16);
  const b = parseInt(bytes.slice(4, 6), 16);
  return `linear-gradient(135deg, rgb(${r},${g},${b}), #2E68F4)`;
}
