# Brand

The Slash mark, the wordmark, and their rules. Applies to every surface: website, macOS desktop app, artist node, social profiles, print.

Why this mark rather than a bolt, and why the two slashes are uneven: `DECISIONS.md`.

## The mark

Two slashes, four points each, no curves. Drawn in a `0 0 100 100` viewBox:

```
leading   polygon points="7,92 37,8 59,8 29,92"     width 22 units
trailing  polygon points="45,92 75,8 93,8 63,92"    width 18 units
```

Both at the same angle: rise 84, run 30, ratio **0.357**. The leading stroke is wider than the trailing one — that asymmetry is the mark. Two equal strokes read as a repeated shape; the uneven pair reads as one gesture with direction. Do not regularise it.

The pair spans x 7–93 and y 8–92, centred on 50 in both axes.

## Lockup

```
mark box     = wordmark font size x 1.2
gap          = mark box x 0.35
clear space  = two leading-slash widths on all four sides (mark box x 0.45)
wordmark     = JetBrains Mono 700, letter-spacing -0.02em, lowercase "lightning.fm"
min lockup   = 140px wide
min mark     = 16px, single-slash variant
```

Worked examples:

| Context | Wordmark | Mark box | Gap |
|---|---|---|---|
| Marketing lockup | 52px | 62px | 22px |
| Site header | 18px | 22px | 8px |
| Site footer | 14px | 17px | 6px |

Align the mark's **visible left edge** (7 units in, so `0.07 x mark box`) with the text column, not its bounding box — otherwise the mark sits inset from everything below it.

## Colourways

Four approved combinations:

| Mark | Ground | Use |
|---|---|---|
| `#171208` ink | `#F7F2E6` cream | daylight, default |
| `#F5E6C8` bone | `#171208` ink | reversed, print |
| `#171208` ink | `#E8A917` amber | app icon, favicon |
| leading `#E8A917` / trailing `#F5E6C8` | `#0D0D0D` black | moonlight only |

**Amber is never the mark on a light ground.** `#E8A917` on `#F7F2E6` is 1.9:1 — it disappears. The two-tone version is moonlight-only; it needs a dark ground to read as deliberate.

## Do not

- Rotate the mark. The slant is the whole thing.
- Stretch it — always `preserveAspectRatio` default, never `none`.
- Use amber on cream.
- Equalise the two slash widths.

## The 16px exception

At 16px the two slashes and the gap between them fall below one pixel and mush into a grey block. The 16px icon is therefore the **leading slash alone** — same angle, same width, one stroke:

```
polygon points="4,14 8.3,2 11.8,2 7.5,14"
```

Run over rise is 4.3/12 = 0.357, matching the canonical mark. This is the only sanctioned deviation. Everything from 32px up uses the full mark.

## App icon geometry

Amber tile, ink mark, inset via `transform="translate(8 8) scale(0.48)"` in a `0 0 64 64` viewBox. That translation centres the mark exactly on both axes — `(64 - 41.28) / 2 = 10.4` horizontally and `(64 - 40.32) / 2 = 11.84` vertically, minus the mark's own 7-unit and 8-unit offsets. Do not eyeball it.

## Files

Production files live in `assets/`. Ship as-is — they are pure geometry.

| File | Destination | Notes |
|---|---|---|
| `assets/lfm-icon.svg` | `src/app/icon.svg` | amber tile, ink mark, 64px |
| `assets/lfm-icon-16.svg` | `public/favicon-16.svg` | single slash |
| `assets/lfm-og-image.png` | `public/og-image.png` | 1200x630, moonlight — ships as default; **generated**, see Social cards |
| `assets/lfm-og-image-daylight.png` | `public/og-image-daylight.png` | 1200x630, cream; **generated**, see Social cards |
| `assets/lfm-mark-ink.svg` | inline in header/footer | daylight theme |
| `assets/lfm-mark-amber.svg` | inline in header/footer | moonlight theme, dark grounds |
| `assets/lfm-mark-bone.svg` | print, reversed on ink | |

For the header and footer, inline the polygons rather than loading an SVG file — the mark is nine lines of markup and needs to switch fill with the theme. `fill="currentColor"` on both polygons and let the parent set the colour, so daylight and moonlight are handled without a second asset.

## The standalone lockup

Delivered, with the wordmark converted to real outlines so the files never
depend on JetBrains Mono being installed on the machine opening them:

| File | Use |
|---|---|
| `public/lightning-fm-lockup.svg` | ink, light grounds |
| `public/lightning-fm-lockup-bone.svg` | dark grounds |

Marketing-lockup geometry (52px wordmark, 62px box, 22px gap, -0.02em
tracking) with the clear space baked in as padding. Regenerate with
`scripts/gen-lockup.mjs` in the web repo — its header documents the two
one-off prerequisites (opentype.js and the Bold TTF); they are deliberately
not project dependencies.

## Social cards

Moonlight is the default: dark cards hold their edge against both light and dark feed backgrounds, where the cream one dissolves into a light background.

Daylight drops the two-tone mark (amber is never the mark on cream) — both slashes go ink and the accent moves to the price in the tagline.

Both cards are written in dollars, not sats, per audit finding 3. This image is the first thing a musician sees when the link is shared.

Card layout, 1200x630: lockup top-left at a 96px inset (mark box 66px, wordmark 55px, gap 23px, baseline 157); headline JetBrains Mono 700 at 68px, baselines 356 and 440; tagline 28px at baseline 508, with "A $10 album pays you $10." in the accent colour.

**The cards are generated, not hand-exported.** `scripts/gen-og-image.mjs` in the web repo renders both themes from this layout spec (an inline SVG whose `<text y>` values are the baselines above) in the actual brand font, and writes `public/og-image*.png`. The original design-tool exports had silently fallen back to a system mono for the text; the script output supersedes them. Change the card by changing the script, then regenerate — never by editing pixels.
