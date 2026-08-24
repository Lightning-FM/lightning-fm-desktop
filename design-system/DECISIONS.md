# Decisions

Why things are the way they are. **Read this before changing something that looks arbitrary.**

Every entry is a call that was made deliberately, with the reasoning that produced it and the alternative that was rejected. Most of these have already been "fixed" by someone who did not know the reason — that is what this file is for.

IDs follow the convention already in the codebase (`decision:lfm_pricing_no_rake_flat_convenience`). Cite them in code comments where the reason is not local.

---

## Brand

### `decision:lfm_mark_slash_over_bolt`
**The logo is two slashes, not a lightning bolt.**

Four directions were explored: a stepped bolt, a waveform, the slashes, and a split cursor block. The slashes were chosen because they are typographic rather than pictorial — lifted from the `::` already in the page titles — so they belong to the terminal identity completely, and because every other bitcoin-music project reaches for a bolt.

The cost, accepted: on its own the mark says "protocol", not "music". It needs the wordmark beside it. Rejected: the waveform (says music immediately, but generic), the bolt (continuity, but crowded space).

### `decision:lfm_mark_uneven_slash_widths`
**The leading slash is 22 units wide, the trailing one 18.**

Two equal strokes read as a repeated shape. The uneven pair reads as one gesture with direction. This was regularised to 22/22 once during asset production and had to be restored — if you find yourself making them match, you are undoing this.

### `decision:lfm_amber_never_mark_on_light`
**Amber never carries the mark on a light ground.**

`#E8A917` on `#F7F2E6` is 1.9:1. Four colourways are approved: ink-on-cream, bone-on-ink, ink-on-amber, and two-tone on black. The two-tone version is moonlight-only — it needs a dark ground to read as deliberate rather than accidental.

### `decision:lfm_favicon_single_slash_at_16`
**The 16px icon is one slash, not two.**

At 16px the two slashes and the gap between them fall below a pixel and mush into a grey block. The single slash keeps the angle (0.357 run over rise) and the width. This is the only sanctioned deviation from the canonical geometry; everything from 32px up uses the full mark.

### `decision:lfm_wordmark_optical_left_align`
**The lockup shifts left by 0.07 × mark box.**

The mark's visible ink starts 7 units into its 100-unit viewBox. Aligning the bounding box leaves the mark looking inset from the text column below it; aligning the ink looks correct. ~1.5px at header size — small, and visible once you know.

---

## Theme

### `decision:lfm_theme_three_states_cycling_icon`
**Theme is a three-state cycling icon button, not a two-state toggle or a segmented control.**

The original control was a text button reading `[ moonlight ]` whose label named the destination while `aria-pressed` reported the current state — announcing "moonlight, pressed", which is meaningless. Adding a third option made that label impossible to write honestly.

Two solutions were built and compared. The segmented control shows all three states and was the better control; the icon fits the header, which is where it had to live. **The icon won on placement, not on merit.** If it ever moves to the footer, revisit — with room to show all three, there is no reason to hide two.

The accepted cost: a user on daylight who wants system must click twice, guessing, passing through moonlight. Theme is a once-per-install action, so this is a fair trade. The tooltip naming the next state is the mitigation.

### `decision:lfm_theme_glyph_shows_current_state`
**The glyph shows the theme you are on, not the one you are going to.**

This is the inversion of the old control and the thing that resolves the accessibility problem. The accessible name carries both halves — "Theme: moonlight. Change to system." — and never uses `aria-pressed`, because a three-state cycler is not a toggle.

### `decision:lfm_theme_icons_three_circles`
**Three circles: rayed disc, crescent, half-filled. Not sun/moon/monitor.**

A display icon for "system" names the device rather than the setting, and breaks the family — the three no longer read as one control. The half-filled circle is the standing convention for automatic contrast, and it happens to echo the split-block logo direction, so it does not arrive from nowhere.

### `decision:lfm_theme_store_selected_not_resolved`
**`lfm-theme` stores the selected value; the html class holds the resolved one.**

Storing the resolved value is the standard bug: a user picks "system" on a light morning, "daylight" gets written, and their preference silently stops following the OS forever. Absent means system, so first-time visitors follow their OS with nothing stored.

The pre-paint script owns resolution — including live OS flips — so pages follow the OS whether or not a switcher is mounted. Miss this and every system-mode visitor gets a flash of the wrong theme on first paint.

### `decision:lfm_no_theme_transition`
**The palette swaps instantly. No crossfade, no icon morph.**

Cross-fading an entire palette is worse than an instant switch, and a morphing glyph on top of a palette change is two animations fighting. Neither would be guarded for `prefers-reduced-motion`.

---

## Navigation

### `decision:lfm_shared_site_shell`
**One `SiteHeader` and `SiteFooter`; no page builds its own.**

The nav was previously inlined on ~22 pages. Consequences that were live in production: the theme switcher existed on the homepage only, "Learn" was promoted to the header on the homepage only, and other pages had a two-item nav, a different wordmark size, no sticky behaviour, and no footer at all.

Verify with `rg -l 'hover:text-\[var\(--amber\)\]' src/app | wc -l` — it should be 0.

### `decision:lfm_nav_breakpoint_860`
**The mobile breakpoint is 860px, not Tailwind's `md`.**

Measured: five links ≈ 515px, lockup 140px, theme icon 44px, plus gaps ≈ 750px before wrapping. At `md` (768px) it still wraps. 860 leaves headroom for a sixth link.

### `decision:lfm_mobile_panel_pushes`
**The mobile panel pushes the page down. No overlay, scrim, or scroll lock.**

Five links is short enough that the page underneath remains context rather than clutter. Revisit if the nav grows past about seven items.

### `decision:lfm_theme_icon_stays_in_bar`
**The theme icon stays in the mobile bar, not inside the panel.**

It is 44px. Reclaiming that by burying a preference two taps deep is a bad trade.

### `decision:lfm_learn_in_header`
**`/learn` is a top-level header item.**

Fourteen explainer articles were linked only from the footer. For an audience new to bitcoin that library is the site's best asset, and it was the least reachable thing on the page.

---

## Emphasis and layout

### `decision:lfm_one_amber_fill_above_fold`
**Exactly one amber-filled element above the fold: the primary CTA.**

A filled nav button and a filled hero button at the same weight compete and neither wins. This is why the header nav has no CTA button, the mobile panel's "Start selling" is a plain row, and the newsletter Subscribe is outlined.

### `decision:lfm_two_emphasis_levels`
**Two levels of section emphasis, not one.**

Seven sections with identical treatment read as a list of equally-weighted panels — the reader cannot tell which is the argument. One or two sections per page go loud (full-bleed ink, larger type); the rest stay quiet. The fee comparison is the loud one on the homepage.

### `decision:lfm_two_content_widths`
**1120px for marketing, `max-w-3xl` for prose. Both correct.**

The chrome must be identical across pages; the measure should not be. A learn article at 1120px is unreadable. The `width` prop on the shell is what makes adopting it possible without re-laying-out fourteen articles.

### `decision:lfm_zero_radius`
**Border radius is zero, everywhere.**

Terminals do not have rounded corners. It is the most recognisable property of the system, and every `--radius-*` token is set to 0 specifically so a stray `rounded-md` has nothing to resolve to.

### `decision:lfm_design_site_same_repo`
**The design system publishes at `design.lightning.fm` from the web repo, not its own repo.**

This directory is canonical in the web repo (see `README.md`), and the published site renders these exact files: `/design` in the app reads `design-system/*.md` at build time, and `src/middleware.ts` rewrites the subdomain onto that route group. One deploy, so the published spec and the working spec cannot version-skew — a separate repo would reintroduce the copy-drift this system exists to end.

The design site uses its own light shell rather than `SiteHeader`: its nav is the doc set, not the marketing nav. Like `/admin`, it is a distinct surface, not a marketing page opting out.

It is also internal: every `/design` request on either host is gated on the same `ADMIN_KEY` as `/admin` (httpOnly cookie set by `/api/design-auth`, checked in the proxy, failing closed), and kept out of search and AI indexes at every layer — `X-Robots-Tag: noindex` on every response, noindex metadata, and a disallow-all `robots.txt` on the subdomain.

---

## Copy

### `decision:lfm_dollars_before_sats`
**Heroes, tier headlines, and social cards are written in dollars.**

The audience is musicians new to bitcoin. "Sats" appeared in the first sentence under the headline, undefined — unfamiliar vocabulary in the opening paragraph signals to the reader that they are not the intended audience. "A $10 album pays you $10" is the strongest line available. Sats get introduced once, below the fold, with a gloss.

### `decision:lfm_benefit_before_mechanism`
**Benefit first, mechanism second, with the mechanism linked out.**

The artist panel opened with "your catalog is Nostr events signed by your key" — three unknowns for this reader — and the reason they should care arrived second.

### `decision:lfm_ctas_promise_what_happens`
**A button's label matches what the click actually does.**

"Start selling" and "Claim your artist page" both scrolled to a mailing list. The gap between the click and the outcome is where motivated people leave, at the one moment you had their full intent. When the beta ended the labels became true; if a gate returns, the label says so at the button.

### `decision:lfm_no_fake_artist_data`
**Bracketed placeholders, never invented bands.**

Fake data on a marketing page is a claim you did not mean to make. It also reads as a template the visitor will fill, which is the right feeling.

### `decision:lfm_claims_track_build_status`
**Nothing is present-tense unless it has shipped.**

House rule, predates the design work. Fee claims carry a source and a checked date, coupled in code so a claim cannot ship without its citation.

---

## Product

### `decision:lfm_hero_plays_real_music`
**The homepage hero is a live, playable storefront.**

A music platform whose homepage made no sound was the most expensive defect found in the audit. The hero was a static drawing of a storefront full of `[your album]`; a musician could not hear what their page would be, and a listener had nothing to react to. Everything needed to make it real already shipped.

### `decision:lfm_pricing_page_canonical`
**`/pricing` is the single source of pricing detail.**

The homepage had a full three-tier section and `/pricing` had its own copy. Two places to update means one will be wrong. The homepage now carries one number and one line per tier and links out; each tier cell is a whole-cell link.

### `decision:lfm_pricing_no_rake_flat_convenience`
**No percentage anywhere. Flat fees for hosting only.**

Pre-existing product decision, recorded here because the design leans on it: buyers pay artists directly, so there is nothing for a rake to be taken from. "Zero" is architecture, not pricing — which is a stronger claim than a discount and should be written that way.
