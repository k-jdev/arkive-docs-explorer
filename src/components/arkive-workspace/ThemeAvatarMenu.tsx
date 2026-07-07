"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, Sun, Moon } from "lucide-react";

function getStoredTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  try {
    return (localStorage.getItem("theme") as "light" | "dark") ?? "dark";
  } catch {
    return "dark";
  }
}

export function ThemeAvatarMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Sync from DOM on mount (the no-flash script may have already set .light)
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
    try {
      localStorage.setItem("theme", next);
    } catch {}
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        className="grid h-6 w-6 place-items-center rounded-full border border-border bg-secondary text-muted-foreground transition-colors hover:border-border hover:bg-secondary/80"
      >
        <span aria-hidden="true" className="text-2xs">●</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-0 z-50 mb-2 w-44 overflow-hidden rounded-lg border border-border-subtle bg-popover shadow-lg"
        >
          {/* Theme toggle row */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
          >
            <span className="font-code text-xs text-foreground">
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </span>
            <span
              className={`relative inline-flex h-3.5 w-6 shrink-0 rounded-full transition-colors duration-200 ${
                theme === "light" ? "bg-primary" : "bg-muted-foreground/20"
              }`}
            >
              <span
                className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-all duration-200 ${
                  theme === "light" ? "left-[13px]" : "left-px"
                }`}
              />
            </span>
          </button>

        </div>
      )}
    </div>
  );
}
