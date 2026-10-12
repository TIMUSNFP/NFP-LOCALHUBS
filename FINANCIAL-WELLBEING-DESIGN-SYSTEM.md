# Financial Wellbeing — Design System Reference

> **Purpose of this file.** A complete reference of the actual design system, component
> library, page templates, and interaction patterns used across the live Financial
> Wellbeing product (`static-site/`), written so it can be reused to restyle **another
> project — NFP Circles** — to feel like the same family of product without re-deriving
> every decision from scratch.
>
> Note: this is a **different design system** from `DESIGN-SYSTEM.md` in this same repo,
> which documents the separate NetworkFP marketing-landing-page/blog template (QPFP vs
> CFP comparison pages). That one uses orange/navy/green + Young Serif/Roboto Slab. This
> one — Financial Wellbeing, the actual consumer product — uses a different, warmer
> palette and a self-hosted custom serif. Don't mix the two.

---

## 0. If you are Claude, working in the NFP Circles repo

You've been pointed at this file to restyle NFP Circles to match Financial Wellbeing's
design language. This file is reference, not code to copy-paste blind — NFP Circles has
its own existing markup, components, and constraints. Work like this:

1. **Read this whole file first**, then survey the NFP Circles repo the same way: find its
   current CSS entry point/tokens file, its component patterns, and its page templates.
   Don't start editing before you know what you're replacing.
2. **Port §1 (tokens) first, verbatim.** Colors and font stacks are the foundation
   everything else in this file assumes. If NFP Circles already has a token system
   (CSS custom properties, a Tailwind config, a theme file), map onto *that* mechanism
   rather than introducing a second, parallel one.
3. **Decide the heading-font question up front** (§1's "script accent" note) — licensed
   "The Youngest Serif," or the Georgia fallback — before touching any component, since it
   affects every heading size/weight decision downstream. Ask the user if it's not already
   decided; don't silently pick one.
4. **Apply §2–§9 (typography, buttons, headers, section banding, cards, tables, forms,
   progress/status) as the component-level source of truth**, adapting class *names* to
   whatever convention NFP Circles already uses — the visual rules (colors, radii, spacing,
   the hover-expand-in-a-grid technique, the 4:5-photo-in-context caveat, etc.) are what
   must carry over, not Financial Wellbeing's literal class names.
5. **Match templates to intent using §10**, not by copying page-for-page — a marketing page
   in NFP Circles gets the marketing-page pattern, a multi-step flow gets the minimal
   header, etc.
6. **Before delivering**, run the §13 checklist and report back what you decided for the
   open items (especially the font-licensing question) rather than assuming.
7. If NFP Circles' existing visual direction conflicts with something here (e.g. it
   already has a settled color system of its own), **stop and ask** rather than overwriting
   established decisions — this file describes Financial Wellbeing's system to borrow from,
   it isn't authorized to unilaterally replace NFP Circles' own.

---

## 1. Design tokens

All colors and fonts are locked to this exact set — nothing outside it. Source: `static-site/css/styles.css` `:root`.

```css
:root {
  --brand-orange: #ff5000;   /* primary accent — CTAs, links, active states, the ONE bold color */
  --brand-dark:   #333333;   /* body text on white — never pure black */
  --brand-white:  #ffffff;
  --brand-slate:  #6a7d8b;   /* captions, footnotes, secondary labels */
  --brand-cream:  #efe7dc;   /* section/testimonial backgrounds, cell fills — never a UI chrome color */
  --brand-mint:   #d7e7df;   /* small accent blocks only — never a full background */
  --brand-gray:   #b0b0b0;   /* low-contrast use only — never a full background */
  --brand-border: rgba(176, 176, 176, 0.4);

  --font-body:    "Lato", Arial, Helvetica, sans-serif;
  --font-heading: "The Youngest Serif", Georgia, serif;  /* self-hosted, see below */

  --max-width: 1152px;  /* .container */
  --radius:    10px;    /* inputs, small cards, pills-that-aren't-fully-round */
  --radius-lg: 24px;    /* cards, panels, portal boxes */
}
```

**Two colors do almost all the work**: orange for anything actionable/emphasized, cream for
section separation. Green (`--ws-positive: #15803d`) and red (`--ws-shortfall`/`#dc2626`)
are used *only* semantically (funded/shortfall, done/error) — never decoratively.

### Fonts are self-hosted, not Google Fonts
```css
@font-face { font-family: "Lato"; src: url("assets/fonts/lato-regular.ttf"); font-weight: 400; }
@font-face { font-family: "Lato"; src: url("assets/fonts/lato-medium.ttf"); font-weight: 500; }
@font-face { font-family: "The Youngest Serif"; src: url("assets/fonts/the-youngest-serif-book.ttf"); font-weight: 400; }
@font-face { font-family: "The Youngest Serif"; src: url("assets/fonts/the-youngest-serif-bold.ttf"); font-weight: 700; }
```
"The Youngest Serif" is a paid/licensed font — **not on Google Fonts**. If NFP Circles
can't license it, the documented fallback (and what every email in the product already
renders as, since email clients can't load custom fonts) is plain **Georgia**. That's a
legitimate, intentional fallback, not a compromise — use it directly if licensing isn't
worth it for a second project.

### The "script accent" — not a script font
Despite the name, there's no cursive typeface in the live product. The handwritten-feel
accent seen on hero/section headings is **the same serif, set in italic**:
```css
.hero h1 .script-line,
.section-heading h2 .script-word {
  font-family: var(--font-heading);
  font-style: italic;
  font-weight: 400;
  color: var(--brand-orange);
}
```
Use this pattern, not a separate cursive/script webfont — it was deliberately replaced
site-wide for reliability and voice consistency.

---

## 2. Typography scale

| Role | Size | Font | Notes |
|---|---|---|---|
| Hero H1 | 2.75rem | heading serif | `.script-line` sub-line in italic orange |
| Section H2 | 2.25rem → 2.75rem (≥640px) | heading serif | centered, max-width 40rem via `.section-heading` |
| Card/component H3 | 1.25–1.3rem | heading serif | |
| Body | 1rem, line-height ~1.6 | body sans | `--brand-dark` |
| Secondary/caption | 0.78–0.9rem | body sans | `--brand-slate` |
| Eyebrow (kicker label) | 0.85rem | body sans | uppercase, `letter-spacing: 0.15em`, `font-weight: 700`, `color: var(--brand-orange)` |

```css
.eyebrow {
  font-size: 0.85rem; font-weight: 700; letter-spacing: 0.15em;
  color: var(--brand-orange); margin: 0 0 1rem;
}
```
Every section on the marketing pages opens with an eyebrow. It's the single most-reused
micro-pattern in the product — bring it to NFP Circles as-is.

---

## 3. Buttons

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  padding: 0.85rem 1.75rem; border-radius: 999px;  /* fully pill-shaped, always */
  font-weight: 700; font-size: 0.95rem; border: none; min-height: 44px; /* touch target */
  transition: background-color 200ms ease, transform 150ms ease;
}
.btn-primary { background: var(--brand-orange); color: var(--brand-white); }
.btn-primary:hover { background: #e64800; }
.btn-ghost   { background: transparent; color: var(--brand-dark); font-weight: 500; }
.btn-ghost:hover { background: var(--brand-cream); }
.btn--header { padding: 0.6rem 1.3rem; font-size: 0.85rem; min-height: 38px; } /* compact, for header rows */
```
Only two variants exist site-wide: solid orange (primary action) and ghost (secondary/nav).
No outline-navy, no white-on-dark variant — deliberately minimal.

---

## 4. Header patterns

Two header systems exist, used deliberately for different page types.

### `.site-header` — full marketing nav
Used on: homepage, Calculators hub, all 4 calculator tools, results page, legal pages, PFP Portal, admin.
```css
.site-header {
  position: sticky; top: 0; z-index: 50;
  background: rgba(255,255,255,0.95); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--brand-border);
}
.logo img { height: 50px; }              /* 40px below 768px */
```
Structure: logo → `.main-nav` (inline row ≥768px, slide-down dropdown `.is-open` below
768px, toggled by a `.mobile-nav-toggle` hamburger) → a persistent primary CTA button on
the right (`.header-actions-buttons`, hidden below 768px in favor of the same CTA living
inside the mobile dropdown).

### `.flow-header` — minimal, distraction-free
Used **only** for genuinely guided, multi-step funnels (the health-check questionnaire,
the booking screen) — deliberately stripped to just logo + a step/back label, on purpose,
to reduce exits mid-flow. Don't default to this for a normal content page; it's an
intentional exception, not the base header.

**Rule of thumb for NFP Circles:** every ordinary page gets `.site-header`. Only a true
step-by-step form/wizard flow earns the minimal header.

---

## 5. Section rhythm — banding

Every homepage section carries a hairline top border and alternates a light cream wash
against the plain white body background, so the page reads as distinct bands instead of
one continuous scroll:
```css
.some-section {
  padding: 6rem 0;
  border-top: 1px solid var(--brand-border);
  background: rgba(239, 231, 220, 0.4);   /* omit this line to keep a section plain white */
}
```
**Exception:** skip the cream wash on a section that already contains its own cream-tinted
card inside it (e.g. a callout box) — otherwise the card blends into its own background
instead of standing out. Alternate white/cream section-by-section down the page.

---

## 6. Cards

### Generic content card (tool/calculator cards, hover-reveal description)
```css
.tool-card {
  padding: 2rem; border: 1px solid var(--brand-border); border-radius: var(--radius-lg);
  background: var(--brand-white); transition: border-color 150ms, transform 150ms, box-shadow 150ms;
}
.tool-card:hover { border-color: var(--brand-orange); transform: translateY(-2px); box-shadow: 0 16px 32px rgba(0,0,0,0.12); }
.tool-card p { max-height: 0; opacity: 0; overflow: hidden; transition: max-height 200ms, opacity 200ms; } /* collapsed by default */
.tool-card:hover p { max-height: 8rem; opacity: 1; } /* description reveals on hover/focus */
```
Positioned via `position:absolute; inset:0` against a `.tool-card-slot` wrapper with its
own `min-height` — this is the fix for a real bug: an expanding hover card inside a CSS
grid otherwise pushes the whole grid row down (shared row-track sizing), not just its own
column. Absolute-positioning against a slot sidesteps that entirely. Reuse this exact
technique for any hover-expand card in a grid.

### Photo-forward match card (4:5 portrait, not a banner)
```css
.match-card { border: 1px solid var(--brand-border); border-radius: var(--radius-lg); overflow: hidden; }
.match-photo { aspect-ratio: 4 / 5; width: 100%; }
.match-photo img { width: 100%; height: 100%; object-fit: cover; }
```
**Hard-won lesson, worth carrying forward:** 4:5 is correct when the photo is one card in
a multi-column grid (each card is narrow). It is **wrong** if reused as a single full-width
banner in a wide container (e.g. an email) — do the math on the actual rendered width
before reusing an aspect ratio in a different context; a ~2.8:1 crop of a headshot looks
badly squashed.

### Simple bordered panel (portal, forms)
```css
.portal-card { border: 1px solid var(--brand-border); border-radius: var(--radius-lg); padding: 2.5rem; }
.portal-card--narrow { max-width: 30rem; margin: 0 auto; text-align: center; }
```

### Stat card (admin dashboard)
```css
.admin-stat-card { border: 1px solid var(--brand-border); border-radius: var(--radius); padding: 1.25rem; text-align: center; }
.admin-stat-card__value { font-family: var(--font-heading); font-size: 1.9rem; }
.admin-stat-card__label { margin-top: 0.35rem; font-size: 0.8rem; color: var(--brand-slate); }
```

---

## 7. Tables

Two dashboard-style table conventions, shared shape:
```css
.admin-table th { background: var(--brand-cream); font-weight: 700; }
.admin-table th, .admin-table td { padding: 0.65rem 0.9rem; border-bottom: 1px solid var(--brand-border); }
```
Wrap any wide table in a horizontally-scrolling container (`overflow-x: auto`) rather than
letting it force the page to scroll sideways. For a data-entry table specifically, a
`position: sticky; top: 0;` header row (inside its own scroll container) keeps column
labels visible while scrolling rows — cheap, worth doing on any table over ~6 rows.

---

## 8. Forms

```css
.text-input {
  padding: 0.65–0.75rem; border: 1.5px solid var(--brand-border); border-radius: var(--radius);
  font-family: var(--font-body); background: var(--brand-white);
}
.text-input:focus-visible { border-color: var(--brand-orange); outline: none; }
```
Labels: small, uppercase-ish, `--brand-slate`, bold, sit directly above the field (no
placeholder-as-label). Checklists throughout the product use a literal `☐` unicode
character rather than a styled checkbox element — cheap and legible in both plain HTML and
generated documents alike.

---

## 9. Progress / status

```css
.mini-track { height: 6px; border-radius: 999px; background: rgba(176,176,176,0.22); border: 1px solid var(--brand-border); }
.mini-fill  { height: 100%; background: var(--brand-orange); border-radius: 999px; transition: width 400ms ease; }
```
Status pills (e.g. "Achieved" / "Next milestone") are small, uppercase, letter-spaced,
solid-fill badges positioned top-right of a card — orange for "in progress/next," green
(`#15803d`) only for a genuinely completed/positive state, never for anything else.

---

## 10. Page templates

| Template | Header | Structure |
|---|---|---|
| **Marketing/home** | `.site-header` | Hero → alternating cream/white banded sections (stats, how-it-works, comparison, myths/FAQ) → dark CTA band → FAQ |
| **Tool/calculator** | `.site-header` | Intro + eyebrow → numbered sections (inputs, then results) → footnote disclaimer. A "Download as PDF" toolbar (native `window.print()`, not a client library) is a recurring pattern worth reusing — far more reliable pagination than a canvas/screenshot export |
| **Portal (dashboard)** | `.site-header` | Sidebar nav (Profile / History / Settings-style sections) + content panel — not one long stacked scroll once a page has 2+ genuinely separate concerns |
| **Admin** | `.flow-header` (internal tool, not public-facing) | Password-gated single page: stat-card grid → funnel → bar-row breakdowns → data table(s) |
| **Results/match** | `.site-header` | Score summary → grid of `.match-card`s |

---

## 11. Responsive breakpoints

| Breakpoint | Behavior |
|---|---|
| ≥768px | `.main-nav` inline row; hamburger hidden; persistent header CTA visible |
| <768px | `.main-nav` becomes a toggled dropdown panel; logo shrinks 50px→40px; header CTA moves inside the dropdown |
| 640px / 700px / 720px | Various card grids collapse from multi-column to single column (varies per grid — check `auto-fit`/`minmax` usage first, see note below) |

**Prefer `grid-template-columns: repeat(auto-fit, minmax(Npx, 1fr))` over hard
viewport-width breakpoints** for any grid that might ever render inside a narrower column
than the full page (a sidebar, a modal, a narrower content area) — a fixed-column-count
breakpoint tuned for full-viewport width silently breaks the moment that grid renders
somewhere narrower. This was a real bug fixed this session.

---

## 12. Email design system (bonus — if NFP Circles sends transactional email)

- **Table-based HTML, fully inline styles** — no `<style>` block reliance; Gmail/Outlook
  strip or mis-render external/embedded CSS.
- **Images must be inline CID attachments, not remote `<img src>` URLs.** Confirmed via a
  real Gmail test this session: even fully valid, publicly-reachable image URLs can render
  as broken images because Gmail's own image-loading layer fails to fetch some
  third-party-hosted assets at open time. Embedding the bytes as a MIME attachment
  (`Content-ID`, referenced via `cid:` in the `<img src>`) removes that dependency
  entirely. A static logo can be base64-baked directly into the sending code (resize it
  first — a 3000px-wide source logo has no business being emailed inline unresized).
- **Bulletproof CTA button:** wrap the button table in an outer full-width row with
  `align="left"` on the `<td>`, and put the actual pill-shaped button as a *nested*
  auto-width table inside that cell — putting `align`/float directly on the button's own
  table risks Outlook/legacy engines floating it and wrapping the next paragraph beside it.
- **Color-scheme meta tags** (`<meta name="color-scheme" content="light">` +
  `supported-color-schemes`) stop Gmail/Outlook's automatic dark-mode re-coloring from
  inverting a light-designed email into something illegible.
- Brand colors/fonts in email are the **same tokens as the web app** (`#FF5000`,
  `#333333`, `#EFE7DC`, Georgia/Arial fallback) — one visual identity, not a separate email
  brand.

---

## 13. Applying this to NFP Circles — checklist

- [ ] Decide: license "The Youngest Serif," or commit to the Georgia fallback as the real
      heading font (perfectly legitimate — it's already what every email renders in).
- [ ] Bring over the exact token set in §1 verbatim — don't approximate the hex values.
- [ ] Use `.site-header` (full nav) as the default; reserve a stripped `.flow-header`
      style only for genuinely guided multi-step flows, not as the general-purpose header.
- [ ] Apply section banding (§5) to any long marketing/content page that currently reads
      as one undifferentiated scroll.
- [ ] Reuse the eyebrow pattern (§2) — cheapest, most-repeated piece of visual identity in
      the whole product.
- [ ] For any card grid that might render in a narrower column than full-page width, use
      `auto-fit`/`minmax`, not a viewport-width breakpoint (§11).
- [ ] If NFP Circles sends email, follow §12 exactly — inline CID images, not remote URLs.


use the brand kit folder for Brand inspiration

