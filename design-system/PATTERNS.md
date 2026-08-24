# Patterns

Page-level decisions: what a page is made of, and what gets to be loud.

---

## Page shell

Every page: `SiteHeader`, content, `SiteFooter`. No exceptions on marketing or prose pages. `/admin` is an internal tool and opts out.

```
width="wide"      max-w-[1120px] px-6    marketing, product pages
width="reading"   max-w-3xl px-4         learn articles, prose
```

Two widths is correct. The chrome must be identical; the measure should not be. A learn article at 1120px is unreadable.

---

## Emphasis — the two-level rule

The failure mode this system is prone to: every section becomes a small uppercase heading, a paragraph, and a row of bordered panes, repeated until nothing is louder than anything else. Seven identical sections read as a list of equally-weighted panels, and the reader cannot tell which one is the argument.

So: **two levels, chosen deliberately.**

**Loud** — earn it once or twice per page. Full-bleed ink band, larger type, the page raising its voice. The fee comparison is the canonical example.

**Quiet** — everything else. Hairline-divided cells, ordinary section spacing, `Pane` borders.

If a third section wants to be loud, one of the others is not.

---

## One amber fill above the fold

`--amber-fill` marks the single most important action on the screen. On the homepage that is the hero CTA. The header nav therefore has **no filled button** — a nav CTA and a hero CTA at the same weight compete, and neither wins.

Consequences that follow from this and have come up:

- The mobile panel's "Start selling" row stays plain. On a phone it would sit ~60px from the hero button.
- The newsletter card's Subscribe is outlined, not filled. It is not the page's primary action.
- Tier cards, learn cards, and workstation rows are never amber-filled.

Secondary actions: 2px ink border, transparent, inverting on hover. Tertiary: an amber-text link with a `→`.

---

## Section headers

Heading left, one short link right, aligned on the same baseline:

```
What makes us different?                              Understand →
Pricing                                              Full details →
New to this?                                        All 14 guides →
```

Heading is 34px mono 700 at `-0.02em`. The link is 15px mono in `--amber-text` with a 44px target. Wrap them in `flex flex-wrap items-baseline justify-between gap-4`.

Do not bury the section's outbound link in the body copy — it was tried and it reads as a footnote.

---

## Cards and cells

**Hairline-divided block** for a set of related cells: `grid gap-px` on an ink background inside a 2px ink border. The cells are separated by the ground showing through. Use for tier comparisons, three-audience explainers — anything the reader should read as one object.

**Separate bordered cards** with real gaps for independent items: the learn strip, where each card is its own destination.

Whole-cell links: wrap the contents in an `<a>`, not a click handler on a div, and give it a `--bg-primary` hover so the affordance is visible.

---

## Copy

The audience is **musicians new to bitcoin**. That single fact drives most copy rules here.

- **Dollars before sats.** "A $10 album pays you $10" is the strongest line available. Introduce "sats" once, below the fold, with a one-clause gloss. Never in a hero, never in a tier headline, never on a social card.
- **Benefit before mechanism.** "Nobody can take your page away" then "your catalog is Nostr events signed by your key" — not the reverse. Link the mechanism to `/learn` rather than explaining it inline.
- **Buttons tell the truth.** A button saying "Claim your artist page" that opens a mailing list is the single most expensive defect a page can have. If the click leads to a form, say so on the button.
- **Card titles are the reader's question**, not the article's slug: "Can anyone freeze my money?" not "Fund custody".
- **Never present-tense what has not shipped.** Claims track `/admin` build status. This is a house rule and it predates the design work.
- **No filler.** Cut the reassurance line rather than padding a hero with it.

---

## Placeholders

`[bracketed lowercase]` for content the user will supply. Never invented artist or band names — fake data in a marketing page is a claim you did not mean to make.

`public/images/album-*.svg` holds eight abstract album placeholders in-palette. Use them rather than drawing artwork.

---

## Accessibility patterns

Beyond the numeric floors in `FOUNDATIONS.md`:

- **Icon-only controls** need an accessible name that says both the state and what pressing does.
- **ASCII or block-character charts** get `aria-hidden` plus an `sr-only` prose equivalent.
- **Tooltips** need `aria-describedby` pointing at them from the trigger. Better: if the content matters, make it visible body copy instead of hiding it behind a hover.
- **Forms that branch** must branch their confirmation too. A listener who signs up should not be told about artist onboarding.
- **Every nav item stays reachable at every width.** Hiding "Pricing" below `sm` to save room is not a fix; the hamburger is.
