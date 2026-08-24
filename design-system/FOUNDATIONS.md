# Foundations

Read this before writing any UI. Everything below is already defined in `src/app/globals.css` — **use the custom property, never the literal**.

## Themes

Two, plus follow-the-OS. Daylight is the default: warm cream ground, ink text, retro carried by mono type and hard borders rather than darkness. Moonlight is its complement, amber on black.

Every colour below exists in both. Write `var(--text-muted)`, not a hex, and both themes come free.

## Colour

### Surfaces
```
--bg-primary      #F7F2E6  cream    page ground
--bg-secondary    #FFFDF6  card     raised panels, cards
--bg-tertiary     #EFE7D2           wells, inactive tracks
```

### Text
```
--text-primary    #171208  ink      headings, body on cream
--text-secondary  #4A4232           body copy, nav links at rest
--text-muted      #5C513D           labels, captions   (6.2:1 on cream)
--text-faint      #8A8172           large/decorative ONLY — fails small text
```

### Amber — one accent, three jobs

This is the most-misused part of the system. Amber is not one colour:

```
--amber-text   #8A5E00   amber as TEXT or BORDER  (7:1 on cream)
--amber-fill   #E8A917   CTA and badge FILLS, always with ink text
--amber-dim    #B8860B   fill hover
--on-amber     #171208   text on any amber fill — theme-independent
--amber-glow   rgba(232,169,23,0.25)   selected-state wash
```

`#E8A917` on cream is **1.9:1**. It is a fill colour, never a text colour, never a mark on a light ground. If you want amber text, `--amber-text`.

`--amber-glow` drops to 12% opacity in moonlight, so a translucent selected-state that reads well in daylight vanishes there. Selected states on dark need a solid fill.

### Borders and shadows
```
--border-soft      #D8CFB8   hairline dividers inside a panel
--text-primary               structural borders — 1px or 2px ink
--border-active    #8A5E00   focused/active pane
--shadow-block     4px 4px 0 ink      standard offset
--shadow-block-md  5px 5px 0 ink      primary CTA
--shadow-block-lg  6px 6px 0 ink      hero card
```

Offset block shadows are Daylight's replacement for glows. **They are `none` in moonlight** — do not hardcode them.

### Semantic
```
--success  --warning  --error  --info
```
Darkened on cream, brightened on black. Never raw green/red.

## Border radius

Zero. Everywhere. `--radius` and every `--radius-*` are `0`. Terminals do not have rounded corners. This is the single most recognisable thing about the system — a `rounded-md` anywhere is a bug.

## Type

**JetBrains Mono** for anything structural: headings, labels, numbers, nav, buttons, data. **Inter** for prose paragraphs. Inter ships as one weight — do not ask for 500 or 600.

### Scale

```
54px / 1.06 / -0.025em   700 mono   hero h1        (38px below sm)
34px / 1.1  / -0.02em    700 mono   section h2     (28px below sm)
21px / 1.55              400 inter  lead paragraph
19px / 1.6               400 inter  section intro
17px / 1.6               400 inter  emphasis body
16px / 1.55              400 inter  body — the default
15px / 1.6               400 inter  secondary body, muted notes
15px                     400 mono   nav rows, list rows
13px / 0.06em  upper     400 mono   nav links
12px / 0.14em  upper     400 mono   labels, eyebrows — THE FLOOR
```

Base is 16px, set on `body`. Utilities exist for the small end — `.font-small` (12px), `.font-label` (12px), `.font-body-mono` (14px), `.font-section`, `.font-display` — **prefer them over arbitrary bracket values.** A page full of `text-[13px]` is how the scale drifts.

### Measure

Cap prose. `max-w-[30ch]` for a lead, `42–58ch` for body. Marketing pages run 1120px wide; prose pages run `max-w-3xl` so the measure stays readable. **Both are correct** — the chrome is what should be identical, not the width.

## Spacing

8px grid. Section rhythm is 88px vertical on marketing pages, 24–32px inside panels. Tokens `--space-1` through `--space-8`.

Lay out sibling groups with flex/grid and `gap`, never margins on children or whitespace between inline elements.

## Motion

Sparing, and never on a theme change.

- Colour transitions on hover: fine, `transition-colors`.
- **No transition on the palette swap.** Cross-fading a whole theme is worse than an instant switch.
- **No morphing icons.** Glyphs swap instantly — theme switcher, hamburger.
- `scroll-behavior: smooth` is guarded by `prefers-reduced-motion: no-preference` (fixed 2026-08-22). Keep every animation behind the same guard or inherently motion-safe.

Animations that exist and are legitimate: `lfm-meter` (audio level bars, only while playing), `blink` (terminal cursor), `sat-pulse`, `count-glow`.

## The floors

From a real accessibility audit. Each of these has been broken in this codebase at least once.

```
44px    minimum interactive target on BOTH axes. A 17px-tall nav link
        is the defect that started this list.
12px    minimum interface text. Not 10px, not 11px. If 12px breaks a
        dense table, the layout is wrong, not the floor.
15px    minimum body copy.
4.5:1   contrast for small text. --text-faint fails this by design;
        it is for large or decorative text only.
```

Also structural: every icon-only control needs an accessible name; every disabled control desaturates rather than just dimming (on cream, darkening reads as *more* emphasis, so `globals.css` applies `grayscale(0.7)` plus `opacity: 0.5`).
