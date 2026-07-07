"use client";

/**
 * Left-rail sidebar navigation, GitBook-style.
 *
 * Groups:
 *   - Trading: Dashboard, Wallets, Pending
 *   - Knowledge: Arkives
 *   - Setup: Connect
 *
 * Active state per BRAND.md §5.4: filled bg-secondary, all four corners
 * rounded equally, icon inherits text color (no separate tint), no side
 * border. Section labels are 10px uppercase eyebrow per §3.2.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: () => React.ReactElement };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "Trading",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
      { href: "/wallets", label: "Wallets", icon: IconWallet },
      { href: "/pending", label: "Pending", icon: IconClock },
    ],
  },
  {
    title: "Knowledge",
    items: [{ href: "/arkives", label: "Arkives", icon: IconBook }],
  },
  {
    title: "Setup",
    items: [
      { href: "/connect", label: "Connect Claude", icon: IconPlug },
      { href: "/keys", label: "Keys", icon: IconKey },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-5 pt-3 text-sm">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="px-3 pb-2 font-code text-2xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {g.title}
          </div>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = pathname === it.href || pathname?.startsWith(it.href + "/");
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors duration-120",
                      active
                        ? "bg-secondary font-medium text-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    ].join(" ")}
                  >
                    <it.icon />
                    <span>{it.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* Icons — lucide-style: 16px, strokeWidth=1.75, currentColor (inherits row text). */

function Svg({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

function IconDashboard() {
  return (
    <Svg>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Svg>
  );
}
function IconWallet() {
  return (
    <Svg>
      <path d="M21 12V7H5a2 2 0 010-4h14v4" />
      <path d="M3 5v14a2 2 0 002 2h16v-5" />
      <path d="M18 12a2 2 0 100 4h4v-4z" />
    </Svg>
  );
}
function IconClock() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}
function IconBook() {
  return (
    <Svg>
      <path d="M4 4.5A1.5 1.5 0 015.5 3H19v16H5.5a1.5 1.5 0 010-3H19" />
      <path d="M8 7h7M8 11h7" />
    </Svg>
  );
}
function IconPlug() {
  return (
    <Svg>
      <path d="M9 2v6M15 2v6" />
      <path d="M7 8h10v4a5 5 0 01-10 0V8z" />
      <path d="M12 17v4" />
    </Svg>
  );
}
function IconKey() {
  return (
    <Svg>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.5 12.5 21 2M16 7l3 3M14 9l2 2" />
    </Svg>
  );
}
