import "./globals.css";
import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";

/* Brand fonts — see BRAND.md §3.1.
 * - Inter: body / UI / numbers / addresses (400, 500)
 * - Inter Tight: display / headings ≥19px (600, 700)
 * - JetBrains Mono: reserved for code embeds only (400, 500)
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-sans",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Arkive — your trades, learned",
  description:
    "An MCP-agent trading tool that turns your trading history into a queryable second brain. Connect a wallet, let Claude propose swaps, and build a knowledge graph from every position.",
  icons: {
    icon: [{ url: "/brand/logo-icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/brand/logo-icon.svg" }],
  },
};

/**
 * Root layout — minimal. Just html/body + font setup.
 *
 * The actual app chrome (sidebar + content frame) lives in src/app/(app)/layout.tsx
 * so that auth pages (sign-in) can render full-bleed without nav. The (app) route
 * group has no effect on URLs — /dashboard, /wallets, etc. still resolve as before.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* Apply stored theme before first paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('theme')==='light')document.documentElement.classList.add('light')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
