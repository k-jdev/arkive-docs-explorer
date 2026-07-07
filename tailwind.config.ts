import type { Config } from "tailwindcss";

/* ============================================================================
 * Arkive Tailwind config — semantic color tokens read from CSS vars defined
 * in src/app/globals.css. See BRAND.md for the full system.
 *
 * Rule of thumb: never reach for hex literals in components. Use bg-primary,
 * text-foreground, border-border, etc.
 * ========================================================================== */

const config: Config = {
  // No `dark:` modifiers — theme switching is done by flipping CSS variables on
  // a `.light` class set on <html>. Components stay theme-agnostic and just use
  // semantic tokens (bg-card, text-foreground, etc).
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    /* ──────────────────────────────────────────────────────────────────────
     * TYPE SCALE — the ONLY approved font sizes. Full override (not extend)
     * so stray sizes can't silently resolve. Use the token, never text-[Npx].
     *
     *   2xs  10px   super-small only (badges, eyebrow labels, dense meta)
     *   xs   12px   default UI label / table cell / secondary text
     *   sm   14px   body copy, form inputs, descriptions
     *   base 16px   emphasized body
     *   lg   18px   stat values, small section titles
     *   xl   20px   sub-headings
     *   2xl  24px   page titles (h1)
     *   3xl  28px   large display
     *   4xl  35px   hero numbers
     * ────────────────────────────────────────────────────────────────────── */
    fontSize: {
      "2xs": ["10px", { lineHeight: "14px" }],
      xs: ["12px", { lineHeight: "16px" }],
      sm: ["14px", { lineHeight: "20px" }],
      base: ["16px", { lineHeight: "24px" }],
      lg: ["18px", { lineHeight: "26px" }],
      xl: ["20px", { lineHeight: "28px", letterSpacing: "-0.01em" }],
      "2xl": ["24px", { lineHeight: "30px", letterSpacing: "-0.01em" }],
      "3xl": ["28px", { lineHeight: "34px", letterSpacing: "-0.015em" }],
      "4xl": ["35px", { lineHeight: "40px", letterSpacing: "-0.02em" }],
    },
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        panel: "hsl(var(--panel))",
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        agent: {
          DEFAULT: "hsl(var(--agent))",
          foreground: "hsl(var(--agent-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        border: "hsl(var(--border))",
        "border-subtle": "hsl(var(--border-subtle))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        sm: "calc(var(--radius) - 2px)",  /* 2px */
        md: "var(--radius)",              /* 4px */
        lg: "calc(var(--radius) + 2px)",  /* 6px */
        xl: "calc(var(--radius) + 4px)",  /* 8px */
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        code: ["var(--font-code)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      transitionDuration: {
        "120": "120ms",
      },
    },
  },
  plugins: [],
};

export default config;
