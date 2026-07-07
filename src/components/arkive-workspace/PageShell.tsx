// Shared page shell for non-arkive workspace pages.
//
// Every workspace page (Dashboard, Wallets, Pending, Connect, …) wraps its
// content in this shell so the spacing + scroll behavior stay consistent
// with the Arkive overview tab. The activity rail is provided by the
// workspace layout above; this only owns what lives to the right of it.

import type { ReactNode } from "react";

export function PageShell({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
}: {
  /** Mono micro-label above the title, e.g. "telemetry". */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[1240px] px-8 pb-12 pt-7">
        <div className="flex items-end justify-between gap-6 border-b border-border-subtle pb-5">
          <div className="min-w-0">
            {eyebrow && (
              <div className="font-code text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
                {eyebrow}
              </div>
            )}
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 max-w-[720px] text-sm leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        <div className="pt-6">{children}</div>
      </div>
    </div>
  );
}
