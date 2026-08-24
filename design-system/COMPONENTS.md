# Components

What exists, what it is for, and the rules that are easy to get wrong. Every component here lives in `src/components/` and is shared — if you find yourself rebuilding one of these inline, stop.

Reference renders in `reference/`. Measurements below are authoritative.

---

## Wordmark / SlashMark

`src/components/Wordmark.tsx`

The logo. Polygons are inlined rather than loaded from a file so `fill` follows `currentColor` and both themes work with one asset.

```
<Wordmark size={18} />   lockup: mark + "lightning.fm"
<SlashMark box={17} />   mark alone
```

Construction: mark box = font size × 1.2, gap = box × 0.35, and the box shifts left by `0.07 × box` so the mark's *visible ink* aligns with the text column, not its bounding box. Header 18px, footer 14px.

Never rotate, stretch, equalise the two slash widths, or put amber on a light ground. Full rules in `BRAND.md`.

---

## Pane

`src/components/terminal/Pane.tsx`

The default container. 1px ink border with an optional title notched into the top edge. `active` swaps to `--border-active`.

Use it instead of hand-rolling a bordered div. If you need a 2px border and an offset shadow — a hero card, a primary panel — that is a deliberate step up in emphasis; see `PATTERNS.md`.

---

## ThemeSwitcher

`src/components/ThemeSwitcher.tsx` · reference: `Lightning FM Theme Switcher.dc.html`

One 44px borderless button cycling daylight → moonlight → system. **The glyph names the state you are ON**, not the destination — that inversion is the whole point, and reversing it reintroduces the audit finding this replaced.

- Three circles: rayed disc, crescent, half-filled. **Never** sun/moon/monitor — a display icon names the device rather than the setting and breaks the family.
- Glyph is `--theme-icon` (a step behind nav links), hover `--text-primary`. **Never amber** — amber reads as a selected state, and this button has none.
- Below 16px the crescent closes up. 18px in the nav.
- Accessible name carries both halves: `Theme: moonlight. Change to system.` Recomputed every click, mirrored into `title`. **Never `aria-pressed`** — it is not a toggle.

### Storage — get this right

`lfm-theme` holds the **selected** value (`daylight` | `moonlight` | `system`; absent = system). Never the resolved one: store "daylight" when the user picked system and their choice silently freezes at whatever the OS said that day.

The html class holds the **resolved** theme. The pre-paint script in `layout.tsx` owns resolving system, including live OS flips, so every page follows the OS whether or not the button is mounted. It dispatches `lfm-theme-change`; mounted switchers subscribe via `useSyncExternalStore`.

---

## SiteHeader / SiteFooter

Reference: `Lightning FM Mobile Nav.dc.html` · spec: `PATTERNS.md`

**The shared shell. Every page uses it.** Historically the nav was copy-pasted across 22 pages, which is why the theme switcher shipped on the homepage only and nowhere else.

```tsx
<SiteHeader width="wide" | "reading" showListenAnchor?={boolean} />
<SiteFooter width="wide" | "reading" />
```

Header: `sticky top-0 z-20`, `--bg-primary`, `border-b-2` ink. Wordmark at 18px links to `/`. Nav is one array in this file — Artists, Learn, Pricing, Start selling — so adding a link is one line, site-wide. ThemeSwitcher is always last.

Nav links: 13px mono, `0.06em`, uppercase, `--text-secondary`, hover `--text-primary`, `px-3 py-3.5`, `min-h-[44px]`. **No filled button in the header** — the hero CTA is the only amber fill above the fold.

Footer: `border-t-2` ink, `SlashMark box={17}`, the "Built on Nostr + Lightning" line, four links at 14px with 44px targets.

`SiteHeader` is `"use client"` (it holds menu state and mounts ThemeSwitcher). `SiteFooter` is a server component.

### Mobile nav

Below **860px** the links collapse into a hamburger. 860 is measured, not idiomatic: five links ≈ 515px + lockup 140px + theme icon 44px + gaps ≈ 750px before wrapping. Tailwind's `md` (768px) still wraps.

```
bar height   52px
toggle       44 × 44, 18px glyph, three 18 × 2 bars, gap 4
row height   56px min
row label    15px, 0.06em, uppercase, --text-secondary
row divider  1px --border-soft, none on the last
panel edge   2px ink, bottom only
```

- Render one nav or the other at the breakpoint — do not restyle a single list, or the mobile rows end up as desktop links with padding.
- The panel **pushes the page down**; no overlay, scrim, or scroll lock. Five links is short enough that the page below stays context.
- The **theme icon stays in the bar**, not the panel. 44px is cheap; burying a preference two taps deep is not.
- Bars swap to a cross instantly. No morph.
- Close on Escape (returning focus to the toggle), on navigation, **and on resize past 860px** — that last one is the easy miss: open at 500px, rotate to landscape, and you get a mobile panel under a desktop nav.
- `aria-expanded` + `aria-controls`; label names the action ("Open menu" / "Close menu"). Here the label *should* name the action — unlike ThemeSwitcher, this genuinely is two-state.

---

## FeaturedStorefront

`src/components/home/FeaturedStorefront.tsx` · reference: `Lightning FM Homepage.dc.html`

A real, playable artist storefront. It exists because the homepage of a music platform previously made no sound — the hero was a static mock full of `[your album]`.

`--bg-secondary`, 2px ink border, `--shadow-block-lg`. Artwork 88px. Track rows are real `<button>`s at 52px min-height. 4px amber progress track. Price row, then a footer strip reading "our cut of this sale: $0".

Playback is a real `<audio>` element inside the component; the meter and progress bar read its actual state, never a fake interval. The level meter animates **only while audio actually plays**. When the relay fetch fails it degrades to the `[bracketed]` template mock — never invented artist data.

---

## FeeBand

`src/components/home/FeeBand.tsx`

The fee comparison. Full-bleed ink section — the page's one raised voice.

Two rules that must survive any edit:

1. **Every number keeps its citation.** `SOURCES` and `CHECKED` come from `src/lib/content/fee-sources` so a claim cannot ship without its source and date. Keep that coupling.
2. **The chart stays accessible.** Block characters are `aria-hidden` and paired with an `sr-only` prose description of the same comparison. If you replace the bars, carry the description over.

This section is ink-grounded in **both** themes, so it needs the moonlight text values even in daylight. That is why its colours were originally inlined; they should be explicit tokens (`--fee-bar-rival` etc.) rather than either literals or cross-theme reaches.

---

## UpdatesForm

`src/components/home/UpdatesForm.tsx`

Platform-updates mailing list — formerly the artist beta signup, stepped down when the beta ended. Ink border, **no offset shadow**, outlined Subscribe button rather than an amber fill. It is not the page's primary action and must not look like one.

Posts to `/api/signup`, honeypot retained.

---

## ArtistStorefront / BuyPanel

`src/components/store/`

The real storefront and purchase flow. `BuyPanel` renders a QR code; the QR library needs literal colours, which is a legitimate exception to the no-hex rule. (Canvas drawing is the other: custom properties must be read off computed styles at draw time, with literal fallbacks.)

A dedicated player suite (`PlayerBar` / `TrackTable` / `WaveformVisualizer`) existed but shipped nowhere and was deleted as dead code on 2026-08-22; the station page will grow its own player when it exists.

---

## button.tsx

`src/components/ui/button.tsx`

shadcn's button, radius forced to 0 via the theme. Most buttons in this system are hand-styled because they carry mono uppercase labels and offset shadows; use this one for ordinary cases, not as a reason to import more shadcn primitives.
