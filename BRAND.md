# Brand Guidelines — Arkive

> **How to use this file:** Save as `BRAND.md` at the repo root. Reference in every UI prompt with: *"Follow `BRAND.md` strictly. Build components from the design tokens below (React + Tailwind utilities + the CSS variables in `globals.css`). Do not invent colors, fonts, spacing, radii, or component patterns outside this document."*

---

## 0. Project context

- **Product name:** Arkive
- **One-line description:** An open, user-owned memory layer for AI — plain markdown files, structured to compound, readable by any model over MCP. Trading is the first authored practice: the product can execute on-chain trades through your wallet while every action lands in a structured record that sharpens future reasoning.
- **Audience:** People who want their AI to actually remember and get sharper over time — starting with active crypto traders (memecoin traders, on-chain natives, DeFi users) as the first practice, plus AI-curious power users who already live in Cursor / Claude Code / Obsidian and want portable, model-agnostic memory instead of vendor lock-in.
- **Platform:** Web application (desktop-first, responsive down to tablet — mobile is a future consideration, not a launch target).
- **Tech stack:** Next.js 15 (App Router, React 19, TypeScript), Tailwind CSS v3.4, hand-built React components (no external component library), lucide-react icons, Inter + Inter Tight + JetBrains Mono via `next/font`.
- **Design intent:** Obsidian-grade focus, brutalist-fintech confidence, zero ornament — a serious tool for serious people that earns trust through restraint, not decoration.

---

## 1. Brand personality

**Is:**
- **Confident** — Arkive makes claims without hedging. Empty states say *"No trades yet."* not *"It looks like you haven't added any trades — would you like to?"* The product knows what it is.
- **Restrained** — One accent color, two type weights, no shadows, no gradients on UI chrome. Whitespace is the primary design tool.
- **Technical** — The user is sophisticated. We use words like *MCP agent*, *positions*, *cost basis*, *PnL*, *RPC* without softening them. Numbers stay in monospace with proper tabular alignment.
- **Sharp** — High contrast. Pure blacks against high-luminance text. Clear edges. No "friendly" rounded everything.
- **Calm** — Despite trading being an anxious activity, Arkive itself is not anxious. No flashing reds, no spinning indicators when a quiet check mark will do, no "🔥 LIVE 🔥" tickers.

**Is not:**
- Friendly-cute, gamified, badge-and-streak-driven (this is not Duolingo for trading)
- Gradient-heavy, glassmorphic across the whole UI, neon-everywhere
- Bullish-bro fintech (no rocket emojis, no "to the moon", no green-candle iconography as decoration)
- Beginner-onboarding-shaped (we don't explain what a wallet is; we assume competence)
- Corporate-soft enterprise SaaS (no smiling stock illustrations, no "Welcome to your dashboard!" banners)

**Voice & tone (microcopy):**
- **Button labels:** verb-first, sentence case, no exclamation marks. *"Add trade"*, *"Connect wallet"*, *"Run analysis"*. Never *"Let's add a trade!"* or *"Click here to connect"*.
- **Empty states:** one short declarative sentence + one primary action. *"No positions yet. Connect a wallet to start tracking."* — that's the whole pattern.
- **Errors:** plain language, what happened + what to do, no apology theater. *"Couldn't reach the RPC endpoint. Check your connection or switch providers in Settings."* Never *"Oops! Something went wrong 😔"*.
- **Numbers:** always formatted. Currency with locale-aware separators, percentages with one decimal max, large numbers abbreviated past 10k (`12.4K`, `1.2M`). PnL is signed (`+$1,240.55` / `−$340.12`), never colored as the only signal — pair with an arrow icon.
- **AI / agent outputs:** the agent speaks the same way the product does — direct, no hedging filler. When the agent is uncertain, it says so once and quantifies it ("Low confidence — only 3 similar trades in your history.").

**One-sentence test:** if a piece of copy could appear in a typical Web3 product, rewrite it. Arkive's copy should feel like it was edited by someone who reads more than they tweet.

---

## 2. Color system

> **Rule for Claude:** All colors defined as CSS variables in `globals.css` using the design-token names below. Never hardcode hex values in components. Use `bg-primary`, `text-foreground`, etc. — never `bg-[#2E68F4]`.

### 2.1 Brand palette (raw values)

**Deep dark canvas with saturated `#2E68F4` blue accent for primary actions, and a brighter cyan-leaning `#5BC0EB` reserved for AI/agent moments. Light mode demotes blue to indicator-only; primary actions become black.**

| Role | Dark hex | Light hex | Where it shows |
|---|---|---|---|
| Primary action | `#2E68F4` | `#0A0A0A` | Apply / Save / Submit buttons |
| Primary foreground | `#FFFFFF` | `#FFFFFF` | Text on primary |
| Accent indicator | `#2E68F4` | `#2E68F4` | Brand swatch, focus rings (both modes) |
| **Agent accent** | `#5BC0EB` | `#0891B2` | Agent voice highlights, agent avatar tints, AI-generated badges |
| Background | `#0A0A0A` | `#FAFAFA` | App canvas |
| Panel / sidebar | `#121212` | `#FFFFFF` | Secondary surfaces |
| Elevated / main | `#171717` | `#FFFFFF` | Modal / content card |
| Hover / selected | `#222222` | `#F2F2F2` | Active nav row, hover state |
| Input / muted | `#1F1F1F` | `#FFFFFF` | Form fields, dropdown bg |
| Foreground (body) | `#F2F2F2` | `#171717` | Primary text |
| Heading | `#FFFFFF` | `#0A0A0A` | h1, h2 |
| Muted foreground | `#B4B4B4` | `#666666` | Secondary text, sidebar items |
| Disabled / hint | `#7A7A7A` | `#999999` | Captions, helper text |
| Border default | `#2A2A2A` | `#E5E5E5` | Card outlines |
| Border subtle | `#1F1F1F` | `#F2F2F2` | Row dividers inside cards |

**The two-blue rule:** `#2E68F4` is for the user's actions (CTAs, focus, selection). `#5BC0EB` is for the agent's outputs (suggestions, analysis, confidence indicators). Never mix the two on the same element. If a button triggers an agent action, the button uses the primary blue; the resulting agent output renders in the agent accent.

### 2.2 System / status colors (cool palette)

**Cool-leaning across the board** — teal instead of grass green, rose instead of fire red, cool yellow instead of amber. Keeps everything in the same hue family as the blue accents.

| Role | Hex (500) | Light bg | Light text | Light border |
|---|---|---|---|---|
| Success | `#14B8A6` (teal) | `#CCFBF1` | `#0F766E` | `#99F6E4` |
| Info | `#06B6D4` (cyan) | `#CFFAFE` | `#0E7490` | `#A5F3FC` |
| Warning | `#EAB308` (cool yellow) | `#FEF9C3` | `#854D0E` | `#FEF08A` |
| Destructive | `#F43F5E` (rose) | `#FFE4E6` | `#BE123C` | `#FECDD3` |

**Dark mode status pills:** use the 500 hex at `0.14` alpha for background, `0.30` alpha for border, and the 300 stop for text (`#5EEAD4`, `#67E8F9`, `#FDE047`, `#FB7185`).

**Special case — PnL coloring:** profit uses the success teal, loss uses the destructive rose. Always pair with a directional icon (`arrow-up` / `arrow-down`) and a signed number. Color is never the only signal.

### 2.3 Map to CSS variables (`app/globals.css`)

```css
@layer base {
  :root {
    /* Dark-first — the brand's natural state */
    --background: 0 0% 4%;               /* #0A0A0A */
    --foreground: 0 0% 95%;              /* #F2F2F2 */

    --card: 0 0% 10%;                    /* #1A1A1A */
    --card-foreground: 0 0% 95%;

    --popover: 0 0% 9%;                  /* #171717 */
    --popover-foreground: 0 0% 95%;

    --primary: 220 90% 57%;              /* #2E68F4 blue */
    --primary-foreground: 0 0% 100%;

    --agent: 196 78% 64%;                /* #5BC0EB cyan-blue for AI moments */
    --agent-foreground: 0 0% 8%;

    --secondary: 0 0% 13%;               /* #222222 hover */
    --secondary-foreground: 0 0% 95%;

    --muted: 0 0% 12%;                   /* #1F1F1F */
    --muted-foreground: 0 0% 71%;        /* #B4B4B4 */

    --accent: 0 0% 13%;                  /* #222222 selected rows */
    --accent-foreground: 0 0% 95%;

    --destructive: 350 89% 60%;          /* #F43F5E rose */
    --destructive-foreground: 0 0% 100%;

    --success: 173 80% 40%;              /* #14B8A6 teal */
    --success-foreground: 0 0% 100%;

    --warning: 48 96% 47%;               /* #EAB308 cool yellow */
    --warning-foreground: 0 0% 8%;

    --info: 189 94% 43%;                 /* #06B6D4 cyan */
    --info-foreground: 0 0% 100%;

    --border: 0 0% 16%;                  /* #2A2A2A */
    --input: 0 0% 12%;                   /* #1F1F1F */
    --ring: 220 90% 57%;                 /* matches accent blue */

    --radius: 0.4375rem;                 /* 7px — lightly rounded */
  }

  .light {
    --background: 0 0% 98%;              /* #FAFAFA */
    --foreground: 0 0% 9%;               /* #171717 */

    --card: 0 0% 100%;
    --card-foreground: 0 0% 9%;

    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 9%;

    --primary: 0 0% 4%;                  /* #0A0A0A BLACK in light mode */
    --primary-foreground: 0 0% 100%;

    --agent: 192 91% 36%;                /* #0891B2 deeper cyan on light bg */
    --agent-foreground: 0 0% 100%;

    --secondary: 0 0% 95%;               /* #F2F2F2 — softer hover/active */
    --secondary-foreground: 0 0% 9%;

    --muted: 0 0% 96%;
    --muted-foreground: 0 0% 40%;        /* #666666 */

    --accent: 0 0% 95%;                  /* #F2F2F2 selected — softer */
    --accent-foreground: 0 0% 9%;

    --destructive: 350 89% 55%;
    --destructive-foreground: 0 0% 100%;

    --success: 173 80% 36%;
    --success-foreground: 0 0% 100%;

    --warning: 48 96% 47%;
    --warning-foreground: 0 0% 8%;

    --info: 189 94% 40%;
    --info-foreground: 0 0% 100%;

    --border: 0 0% 90%;                  /* #E5E5E5 */
    --input: 0 0% 100%;
    --ring: 220 90% 57%;                 /* #2E68F4 BLUE focus rings — matches dark mode */
  }
}
```

In `tailwind.config.ts`, extend `colors.agent` to read from `var(--agent)` so Claude can write `bg-agent`, `text-agent-foreground`, `border-agent`, etc.

### 2.4 Color usage rules

- **One primary action per view.** Reserved for the single most important CTA.
- **In light mode, the accent blue is for indicators only** — focus rings, brand swatches. Never use it for button fills in light mode.
- **Focus rings are blue (`#2E68F4`) in both modes.** The accent blue is the single piece of brand color carried across the theme split.
- **Hover and active states in light mode are softer** — `#F2F2F2` rather than darker grays — matching the lift seen in design systems like Coinbase Base ([image 4 reference]). The state shift should feel like a gentle tonal step up, not a heavy contrast change.
- **Active nav items never recolor the icon.** Icon and text always share the same tone. The fill + text promotion to `foreground` does all the work.
- **Agent accent only appears on agent-authored content.** Never use it for user-driven CTAs or generic highlights.
- **Text on colored backgrounds always uses the darkest stop from the same color family**, never pure black or neutral gray.
- **Body text is always `foreground` or `muted-foreground`.** Never use brand or status colors for body text.
- **Status colors are functional only.** No decorative use.

---

## 3. Typography

### 3.1 Type families

| Role | Family | Fallback | Weights |
|---|---|---|---|
| Display (h1, h2, hero, ≥19px) | Inter Tight | Inter, system-ui | 600, 700 |
| Body / UI / **numbers / addresses** | Inter | system-ui | 400, 500 |
| Code embeds only (`<code>`, `<pre>`, terminal snippets) | JetBrains Mono | ui-monospace, monospace | 400, 500 |

**Loading (Next.js):**

```ts
import { Inter, Inter_Tight, JetBrains_Mono } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const interTight = Inter_Tight({ subsets: ['latin'], variable: '--font-display' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })
```

In `tailwind.config.ts`, extend:
- `fontFamily.sans` → `var(--font-sans)`
- `fontFamily.display` → `var(--font-display)`
- `fontFamily.mono` → `var(--font-mono)`

### 3.2 Type scale

**The font-size scale is a closed system.** `tailwind.config.ts` fully overrides
Tailwind's `fontSize` so ONLY these nine tokens resolve. Never write
`text-[Npx]` — there is a token for every allowed size, and arbitrary values are
considered a bug. Sizes are defined in **px** (not rem) so they are exact and do
not scale with the 110% root applied in `globals.css`.

| Token | Size / line-height | Use | Family |
|---|---|---|---|
| `text-2xs` | 10 / 14 | super-small ONLY — badges, eyebrow labels, dense meta | Inter |
| `text-xs` | 12 / 16 | default UI label, table cell, secondary text | Inter |
| `text-sm` | 14 / 20 | body copy, form inputs, descriptions | Inter |
| `text-base` | 16 / 24 | emphasized body, H3 | Inter |
| `text-lg` | 18 / 26 | stat values, small section titles | Inter |
| `text-xl` | 20 / 28 | sub-headings | Inter Tight |
| `text-2xl` | 24 / 30 | page titles (h1) | Inter Tight |
| `text-3xl` | 28 / 34 | large display | Inter Tight |
| `text-4xl` | 35 / 40 | hero numbers | Inter Tight |
| `font-code` | inherits | code embeds only | JetBrains Mono |

**Approved sizes: 10, 12, 14, 16, 18, 20, 24, 28, 35.** 10px is reserved for
genuinely small chrome (eyebrow labels, chips). Everything else starts at 12.

### 3.3 Typography rules

- **Inter Tight uses default tracking.** Never apply `tracking-tight`. Its character widths are already condensed.
- **Inter Tight kicks in at `text-xl` (≥20px) and above.** Below that, use Inter.
- **`text-3xl`/`text-4xl` are for landing pages, empty states, hero numbers, and section openers only.** Inside dashboards and tools, top out at `text-2xl`.
- **Numeric content stays in Inter (or Inter Tight for display sizes) with `tabular-nums`.** Prices, percentages, PnL, timestamps, token amounts — all in the sans family. The `tabular-nums` feature keeps digit columns aligned without dropping into monospace. **JetBrains Mono is reserved for code embeds only** — `<code>`, `<pre>`, terminal snippets. Wallet addresses and tx hashes also stay in Inter (truncated middle-out as before); the brand prefers the cleaner sans line over a wall of monospace.
- **Two weights only: 400 regular, 500 medium.** Display headings use 600 or 700. Never mix more than two weights in one component.
- **Body line length:** 60–75 characters max (`max-w-prose` or `max-w-2xl`).
- **Sentence case everywhere.** Never Title Case, never ALL CAPS, except `text-2xs` (10px) uppercase eyebrow labels with 6% letter-spacing.
- **Wallet addresses and tx hashes are always truncated** middle-out (`0x1234…abcd`) in mono, full value on hover or copy.

---

## 4. Spacing & layout

### 4.1 Spacing scale

Use Tailwind's default 4px scale. **Allowed values only:** `1, 2, 3, 4, 5, 6, 8, 12, 16, 20, 24`. No arbitrary `gap-[13px]`.

### 4.2 Layout primitives

**Comfortable middle density — not compact, not generous.**

- Outer card padding: `p-6` (24px)
- Inner main panel padding: `p-[22px]` or `p-5.5` (22px)
- Sidebar padding: `p-3` (11–12px)
- Nav item padding: `px-3 py-2.5` (12px × 10px)
- Setting row vertical: `py-4` (15–16px)
- Button: `h-9 px-3.5` (36px tall × 14px horizontal), `gap-1.5` with icons
- Input: `h-9 px-3` (36px × 12px)
- Section gap: `gap-4` to `gap-5` between cards
- Page max width: `max-w-7xl mx-auto px-4 md:px-6 lg:px-8`

### 4.3 The "one hero object" rule

Each major view carries **at most one visually focal element** — a 3D-rendered glass coin, an animated graph node, an agent avatar, a single illustrative chart. Everything else on the surface stays bare. Decorate one thing per view, never the whole view.

This applies to dashboards, empty states, marketing surfaces, and landing pages. If a screen has no natural focal element, leave it intentionally empty rather than filling space — restraint is the look.

### 4.4 Breakpoints

Tailwind defaults: `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`. Desktop-first; tablet is the minimum supported width.

---

## 5. Shape, elevation, motion

### 5.1 Border radius — 7px lightly rounded

`--radius: 0.4375rem` (7px). Sits between Vega (6px) and Maia (12px).

Radius sizes:
- `rounded-sm` ≈ 3px (small chips)
- `rounded-md` ≈ 5px
- `rounded-lg` ≈ 7px (buttons, inputs, cards — default)
- `rounded-xl` ≈ 9px (outer panels)
- `rounded-full` (pills only — status badges)

**Brutalist undertone clarification:** the brutalist influence shows up most in marketing surfaces, less in app chrome. Inside the app, "brutalist fintech" means high contrast and sharp typographic hierarchy, not 0px radius and ALL CAPS everywhere. The 7px radius holds throughout the product.

### 5.2 Borders & dividers

- Default: `border border-border` (1px, `--border` token).
- Row dividers inside cards: subtler `border-b border-[--border-subtle]` (#1F1F1F dark / #EBEBEB light).
- No double borders.
- Divide lists with `divide-y divide-border`, not bottom-border-on-every-row.

### 5.3 Elevation — Flat, no shadows

With backgrounds this dark, drop shadows disappear. Separation comes from background steps and borders. No `shadow-sm`, no `shadow-md`, no `shadow-lg`. The only allowed shadow is the focus ring (`box-shadow: 0 0 0 3px rgba(46,104,244,0.18)` in both light and dark — the blue ring is consistent across modes).

**Exception — the one hero object:** a single focal element per view may carry a soft radial glow or 3D rendering (think Travala/Tangem coin treatment from the moodboard). This is the only place shadows/glows appear, and only on imagery — never on UI chrome.

### 5.4 Selected / active state — filled background, NO side-border, NO icon tint

**Never use a left or right border accent on the active row** (e.g. `border-l-2 border-primary`). This creates an ugly side-rounded artifact where the border meets the row's rounded corners. The active row is always a **full filled background** (`bg-secondary` / `bg-accent`) with all four corners rounded equally.

To indicate which item is selected, use the **filled background** plus a **text color promotion** (muted → foreground) plus `font-medium`. **Never tint the icon a different color from the text** — icon and text always share the same tone. The fill + text-color promotion does the work; a colored icon on top reads as noise.

```tsx
// ❌ NEVER — side border highlight
<div className="border-l-2 border-primary rounded-md bg-secondary">…</div>

// ❌ NEVER — icon in different tone from text
<div className="rounded-md bg-secondary text-foreground">
  <Icon className="text-primary" />
  <span className="font-medium">…</span>
</div>

// ✅ ALWAYS — icon inherits text color, full fill, all corners rounded
<div className="rounded-md bg-secondary text-foreground">
  <Icon /> {/* inherits text-foreground */}
  <span className="font-medium">…</span>
</div>
```

### 5.5 Motion

- Duration: `duration-120` (micro/hover), `duration-200` (state changes), `duration-300` (entrances).
- Easing: `ease-out` for entrances, `ease-in-out` for toggles.
- Reduced motion: wrap non-essential animation in `motion-safe:`.

---

## 6. Iconography & imagery

### 6.1 Icons

- **Icon library:** `lucide-react`. Do not mix icon libraries.
- **Stroke width:** `strokeWidth={1.75}` everywhere. This is the "straight edge" lucide look.
- **Icon sizes:**
  - `h-3.5 w-3.5` inline with body text (14px)
  - `h-4 w-4` inside buttons / nav items (16px)
  - `h-5 w-5` standalone (20px)
- **No emoji** in UI chrome. Emoji are fine in user-generated content only (e.g. trade notes).

### 6.2 Imagery direction

Arkive uses imagery sparingly. When it appears, it follows one of three modes — never decorative photography, never stock illustrations, never abstract gradient blobs.

**Mode A — The glass object.** A single 3D-rendered isometric or near-isometric object on pure black: a glass coin, a knowledge cube, a node, an Arkive logo mark. Backed by a soft radial glow (purple `#7C3AED`-ish or the agent cyan `#5BC0EB`) bleeding outward into black. Inspired by the Travala/Tangem treatment in the moodboard. Used for: hero sections, major empty states, marketing surfaces, splash screens.

**Mode B — The character / focal figure.** A single rendered character or abstract figure (think the "Be the One" blue-tinted figure in the moodboard) standing alone against a sea of muted black surroundings. Used to convey concept beats — "the one trader who learns from their history" — on landing or onboarding surfaces. Always one focal subject, never groups.

**Mode C — The network graph.** Stylized node-and-edge diagrams (think the "Agents who work while you dream" composition) showing connections between user, agent, wallets, knowledge base. Lines are 0.5–1px in muted gray (`#3A3A3A`); nodes are simple rounded squares or hexagons with the Arkive mark; one node may be tinted with the agent accent to indicate focus. Used to illustrate the product's architecture in marketing and onboarding.

**Rules across all imagery:**
- **Black background, always.** Imagery sits on the page background, not on a card. Never on white in dark mode.
- **One focal element per image.** No collages, no scatter compositions.
- **One light source.** A single soft glow defines the figure; no rim lights, no multi-source dramatics.
- **No stock photography.** No people behind laptops, no abstract handshake metaphors, no city skylines.
- **No iconography of money.** No dollar signs, no rocket ships, no green candles, no charts going up-and-to-the-right as decoration. Charts are data displays, not ornaments.
- **No floating UI screenshots-in-3D.** No "perspective laptop mockup" templates. If a screenshot is shown, it sits flat in a card with the standard 7px radius.
- **AI-generated imagery is acceptable** as long as it conforms to the modes above and is reviewed for the brand restraint test (one focal element, one light source, no decorative excess).

### 6.3 Logo & mark

Three logo assets ship with the project as **SVG** for crisp scaling at any size. All three files live in `/public/brand/` and are referenced via Next.js `<Image>` or plain `<img>` with absolute paths starting from the public root.

| File | Path | viewBox | Aspect | When to use |
|---|---|---|---|---|
| Full lockup, dark mode | `/brand/logo-full-dark.svg` | 1004×293 | 3.43:1 | Header, footer, marketing surfaces on dark backgrounds |
| Full lockup, light mode | `/brand/logo-full-light.svg` | 1004×293 | 3.43:1 | Header, footer, marketing surfaces on light backgrounds |
| Icon only (mark) | `/brand/logo-icon.svg` | 275×275 | 1:1 | Favicons, app icons, small UI contexts (<32px width), social avatars, OG image cropping |

**The mark itself:** a softly-rounded square containing an abstract glyph (a quarter-arc with a small square — reads as an "arc + archive" pun). The mark uses an internal gradient from light gray to mid-gray, set on a near-black (`#111111`) rounded-square plate with a 66px corner radius (in the source viewBox). **The mark already contains its background plate** — never apply another card or border around it.

**Usage examples (Next.js):**

```tsx
import Image from 'next/image'

// Header — pick the variant matching the current theme
<Image
  src="/brand/logo-full-dark.svg"
  alt="Arkive"
  width={140}
  height={41}
  priority
/>

// Icon — for favicons, app icons, tight contexts
<Image
  src="/brand/logo-icon.svg"
  alt="Arkive"
  width={32}
  height={32}
/>
```

**Theme-aware rendering (preferred):** use a `<picture>` element or a client-side theme hook to swap between `logo-full-dark.svg` and `logo-full-light.svg` based on the active theme. Never invert the dark logo in CSS — use the dedicated light file.

```tsx
// Example with a theme hook (next-themes or similar)
import { useTheme } from 'next-themes'

function Logo() {
  const { resolvedTheme } = useTheme()
  const src = resolvedTheme === 'dark'
    ? '/brand/logo-full-dark.svg'
    : '/brand/logo-full-light.svg'

  return <Image src={src} alt="Arkive" width={140} height={41} priority />
}
```

**Sizing rules (SVG scales cleanly to any size, but legibility has limits):**
- Full lockup minimum width: **96px**. Below that, the wordmark becomes unreadable — switch to the icon.
- Icon minimum size: **16px** (favicon territory).
- Header default: **140px wide** (≈41px tall) on desktop, **112px wide** (≈33px tall) on mobile.
- App nav / collapsed sidebar: use the icon at **24–32px**.

**Clearspace:** maintain padding around the lockup equal to the height of the icon plate (~the "a" cap height of the wordmark). Don't crowd it with other elements.

**Don'ts:**
- Don't recolor the mark via CSS `filter`, `fill`, or inline overrides — it ships with its own gradient on a `#111111` plate. To change appearance, edit the SVG source, don't override at render time.
- Don't separate the icon from the wordmark in the full lockup file — if you need just the mark, use `logo-icon.svg`.
- Don't add a border, shadow, or background card around either logo file. The icon plate is the background.
- Don't display the dark-mode lockup on a light background, or vice versa.
- Don't stretch, skew, rotate, or animate the mark.
- Don't inline the SVG source into JSX unless you need to manipulate paths — reference the file as a static asset to keep the document tree small and let the browser cache it.

**Favicon and OG image:**
- Use `/brand/logo-icon.svg` as the source for `/favicon.ico`, `/apple-touch-icon.png`, and as the centerpiece of any Open Graph card.
- Generate PNG/ICO derivatives at build time or via tooling — modern browsers support SVG favicons directly via `<link rel="icon" type="image/svg+xml" href="/brand/logo-icon.svg">`.
- For OG (1200×630), rasterize the icon at 256px centered on a `#0A0A0A` canvas.

---

## 7. Components — rules for Claude

> Arkive does **not** use shadcn/ui or any external component library. Components are hand-built React in `src/components/`, styled with Tailwind utilities + the CSS variables in `globals.css`. There is no `@/components/ui/*`, no `components.json`, no Radix dependency. Build to the tokens in this document.

### 7.1 Setup expectations

CSS variables are defined in `app/globals.css` (§2.3) and `tailwind.config.ts` maps them to utilities (`bg-primary`, `text-foreground`, `bg-agent`, etc.). Tailwind v3.4 with the `@tailwind base/components/utilities` directives. Build new UI from these utilities — don't reach for a component library.

### 7.2 Component usage rules

1. **Reuse existing components in `src/components/`** before writing new ones; match their structure and class patterns.
2. **Compose, don't fork.** Build features from small React components + Tailwind utilities. Keep shared primitives generic; put feature-specific pieces under `@/components/<feature>/`.
3. **Conditional classes:** use a small `clsx`-style join (or template literals kept readable) — avoid brittle string concatenation.
4. **Forms:** controlled React state (`useState`) with explicit handlers. In artifacts/React, never use a raw HTML `<form>` submit; wire `onClick`/`onChange`.
5. **Tables:** for anything >10 rows or with sorting/filtering, build a simple sortable table. Numeric columns use `tabular-nums` and right-align (Inter, not mono — see §3.3).
6. **Dialogs vs side panels:** modal dialog = focused decision; side panel = editing/filters; bottom sheet = mobile only.

### 7.3 Button intents (build these as variants of one Button component)

| Intent | Treatment | When |
|---|---|---|
| Primary CTA | filled `bg-primary text-primary-foreground` | One per view |
| Secondary | `border border-border` (outline) | Cancel, secondary actions |
| Tertiary | ghost (no border, hover `bg-secondary`) | Toolbar, inline actions |
| Destructive | `bg-destructive text-destructive-foreground` | Delete, irreversible |
| Agent action | `bg-agent text-agent-foreground` | Explicit agent-triggering call ("Run analysis", "Ask agent") |

Status badges: neutral `bg-secondary`; `bg-destructive` for errors; outline for counts. Cards: default `border border-border`; nested use `bg-muted/50`.

### 7.4 Things Claude must never do

- Don't install Material UI, Chakra, Mantine, Ant, shadcn/ui, or any other component library — components are hand-built here.
- Don't use `@apply` in CSS to reproduce components.
- Don't write per-component CSS files. Tailwind utilities only, except `globals.css`.
- Don't use inline `style={{ ... }}` for anything with a Tailwind equivalent.
- Don't introduce new colors, fonts, radii, or shadows without updating this document first.
- Don't use side-border highlights for active states (see 5.4).
- Don't tint icons in active/hover rows — icon and text always share the same tone (see 5.4).
- Don't use `tracking-tight` on Inter Tight (see 3.3).
- Don't mix the primary blue and agent cyan on the same element (see 2.1).
- Don't render numeric data in JetBrains Mono — numbers stay in Inter with `tabular-nums`. Mono is reserved for code embeds only (see 3.3).
- Don't decorate views with multiple focal elements — one hero object per view, maximum (see 4.3, 6.2).

---

## 8. Accessibility baseline

- All interactive elements keyboard-reachable; visible `focus-visible:ring-2 ring-ring` state.
- Contrast: body text ≥ 4.5:1, UI/large text ≥ 3:1.
- Every input has a `<Label>`. Icon-only buttons get `aria-label`.
- Don't disable focus outlines. Style them, don't remove them.
- Color is never the only signal — PnL pairs with arrow direction, status pairs with icon, errors include text.
- Wallet addresses and tx hashes: provide a copy-to-clipboard button, don't rely on users selecting truncated text.

---

## 9. Prompt snippet for Claude

Paste at the top of any UI-touching prompt:

> Read `BRAND.md` before writing any UI. Build components by hand from React + Tailwind utilities (no shadcn/ui, no external component library). All colors reference CSS variables (`bg-primary`, `bg-agent`, `text-foreground`, etc.), never hex literals. Use the spacing scale, type scale, and 7px radius defined in `BRAND.md`. Numeric data stays in Inter with `tabular-nums` (JetBrains Mono is for code embeds only). Active states use filled backgrounds with the icon inheriting text color (never tinted separately), and the active fill is `bg-secondary` — a softer light gray in light mode, dark gray in dark mode. Focus rings are blue (`ring-ring`) in both modes. Inter Tight uses default tracking. The agent accent (`bg-agent`) is reserved for AI-authored content only. One focal element per view, maximum. If a design decision isn't covered, ask before improvising.

---

## 10. Change log

| Date | Change | By |
|---|---|---|
| 2026-06 | Initial version for Arkive | — |
| 2026-06 | Reframed §0 to the memory-layer positioning (trading = first authored practice); corrected stack to Tailwind v3.4 + hand-built components (no shadcn/Radix); rewrote §7 and §9 accordingly | — |
