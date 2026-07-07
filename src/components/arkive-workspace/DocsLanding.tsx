"use client";

import { ExternalLink, Presentation, Globe, Layers, TrendingUp } from "lucide-react";
import { LogoMark } from "./LogoMark";

const ARCH_FILES = [
  { label: "Introduction", path: "arkive/docs/architecture/introduction.md" },
  { label: "Arkives", path: "arkive/docs/architecture/arkives.md" },
  { label: "The Compounding Loop", path: "arkive/docs/architecture/the-compounding-loop.md" },
  { label: "Practices", path: "arkive/docs/architecture/practices.md" },
  { label: "MCP Integration", path: "arkive/docs/architecture/mcp-integration.md" },
];

export function DocsLanding({ onSelectFile }: { onSelectFile: (path: string) => void }) {
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[880px] px-8 pb-16 pt-10">

        {/* Hero */}
        <div className="border-b border-border-subtle pb-12 mb-10">
          <div className="flex items-center gap-3 mb-5">
            <LogoMark size={28} className="text-foreground" />
            <span className="font-code text-xs uppercase tracking-[0.16em] text-muted-foreground/60">Litepaper 1.0</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground mb-4">
            Arkive
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
            Arkive is the universal language for AI context. This litepaper proposes a structure for AI memory that is compounding, collaborative, portable across models, and owned by the user outright.
          </p>
          <div className="flex gap-3 mt-7">
            <a
              href="https://arkive.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Website
              <ExternalLink size={11} strokeWidth={2} />
            </a>
            <button
              type="button"
              onClick={() => onSelectFile("arkive/docs/about-arkive/overview.md")}
              className="flex items-center gap-2 rounded-md border border-border-subtle px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary/50"
            >
              Abstract
            </button>
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

          {/* Pitch Decks */}
          <div className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-card p-6">
            <div className="flex items-center gap-2.5">
              <Presentation size={15} className="shrink-0 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="font-medium text-foreground text-sm">Pitch decks</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">View the Arkive and Project DeFi pitch decks.</p>
            <div className="flex flex-wrap gap-2 mt-auto">
              <a
                href="https://www.arkive.xyz/deck"
                target="_blank"
                rel="noopener noreferrer"
                className="font-code text-2xs rounded-md border border-border-subtle px-2 py-1 text-muted-foreground/70 transition-colors hover:border-primary/40 hover:text-foreground"
              >
                Arkive pitch deck
              </a>
              <a
                href="https://www.arkive.xyz/defi-deck"
                target="_blank"
                rel="noopener noreferrer"
                className="font-code text-2xs rounded-md border border-border-subtle px-2 py-1 text-muted-foreground/70 transition-colors hover:border-primary/40 hover:text-foreground"
              >
                Project DeFi pitch deck
              </a>
            </div>
          </div>

          {/* Resources */}
          <div className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-card p-6">
            <div className="flex items-center gap-2.5">
              <Globe size={15} className="shrink-0 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="font-medium text-foreground text-sm">Resources</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">Visit Arkive's resources.</p>
            <div className="flex flex-wrap gap-2 mt-auto">
              <a
                href="https://x.com/arkivexyz"
                target="_blank"
                rel="noopener noreferrer"
                className="font-code text-2xs rounded-md border border-border-subtle px-2 py-1 text-muted-foreground/70 transition-colors hover:border-primary/40 hover:text-foreground"
              >
                X
              </a>
              <a
                href="https://t.me/arkivexyz"
                target="_blank"
                rel="noopener noreferrer"
                className="font-code text-2xs rounded-md border border-border-subtle px-2 py-1 text-muted-foreground/70 transition-colors hover:border-primary/40 hover:text-foreground"
              >
                TG
              </a>
              <a
                href="https://www.arkive.xyz/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-code text-2xs rounded-md border border-border-subtle px-2 py-1 text-muted-foreground/70 transition-colors hover:border-primary/40 hover:text-foreground"
              >
                Website
              </a>
            </div>
          </div>

          {/* Architecture */}
          <div className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-card p-6">
            <div className="flex items-center gap-2.5">
              <Layers size={15} className="shrink-0 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="font-medium text-foreground text-sm">Architecture</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">Learn about Arkive's architecture.</p>
            <div className="flex flex-wrap gap-2 mt-auto">
              {ARCH_FILES.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => onSelectFile(f.path)}
                  className="font-code text-2xs rounded-md border border-border-subtle px-2 py-1 text-muted-foreground/70 transition-colors hover:border-primary/40 hover:text-foreground text-left"
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Project DeFi */}
          <div className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-card p-6">
            <div className="flex items-center gap-2.5">
              <TrendingUp size={15} className="shrink-0 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="font-medium text-foreground text-sm">Project DeFi</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">Learn about Arkive's first core practice.</p>
            <div className="flex flex-wrap gap-2 mt-auto">
              <button
                type="button"
                onClick={() => onSelectFile("arkive/docs/project-defi.md")}
                className="font-code text-2xs rounded-md border border-border-subtle px-2 py-1 text-muted-foreground/70 transition-colors hover:border-primary/40 hover:text-foreground text-left"
              >
                Project DeFi
              </button>
            </div>
          </div>

        </div>

        {/* Footer */}
        <p className="mt-12 text-xs text-muted-foreground/40 leading-relaxed">
          Arkive Litepaper V1 · For informational purposes only ·{" "}
          <span
            className="cursor-pointer underline-offset-2 hover:text-muted-foreground/60"
            onClick={() => onSelectFile("arkive/docs/legal.md")}
          >
            Legal disclaimer
          </span>
        </p>

      </div>
    </div>
  );
}
