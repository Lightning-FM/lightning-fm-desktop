# Reference renders

HTML prototypes. Open any of them in a browser.

**These are not source.** They use inline styles and literal hex because of how they were authored; the codebase uses tokens from `globals.css`. Lift intent, layout, and measurements — never the CSS. Where a render and a spec file disagree, the spec wins.

| File | What it shows |
|---|---|
| `Lightning FM Homepage.dc.html` | The full marketing page: hero with live storefront, fee band, section rhythm, pricing, footer. The best single reference for `PATTERNS.md`. |
| `Lightning FM Theme Switcher.dc.html` | Both theme-control directions. **2a, the cycling icon, is the built one**; 1a, the segmented control, is kept as context for why. Both are live. |
| `Lightning FM Mobile Nav.dc.html` | The header below 860px. Live at 390px, plus closed/open reference frames and measurements. |
| `Lightning FM Logo Slash.dc.html` | The identity package: lockup, colourways, app icon sizes, clear space, social cards, don'ts. |
| `Lightning FM Logo.dc.html` | The four original logo directions. Historical — the Slash was chosen. Kept because it records what was rejected. |
| `Lightning FM Audit.dc.html` | The August 2026 audit: 18 findings against the pre-redesign site, with an annotated recreation. Historical, and the origin of most rules in `FOUNDATIONS.md` and `PATTERNS.md`. |

The homepage render is tweakable — the logo mark and two section toggles are exposed as props.
