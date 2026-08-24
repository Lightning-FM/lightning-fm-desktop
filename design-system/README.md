> **Stamped copy.** Canonical source: `design-system/` in the web repo (`maml/lightning-fm`), copied from commit `776701b` on 2026-08-22. Do not edit here — fix the canonical copy and refresh this one.

# Lightning FM design system

The standing spec for every front-end surface: the website, the macOS desktop app, the artist node UI, and anything built next.

**If you are an agent about to write UI: read `FOUNDATIONS.md` first, then the relevant part of `COMPONENTS.md`. This directory outranks your instincts about spacing, colour, and type size.**

## What is here

| File | Read it when |
|---|---|
| `FOUNDATIONS.md` | Always. Tokens, type scale, spacing, the accessibility floors. |
| `COMPONENTS.md` | Building or touching a shared component. |
| `PATTERNS.md` | Laying out a page, or deciding what gets emphasis. |
| `BRAND.md` | Anything involving the logo, marks, or social cards. |
| `DECISIONS.md` | Before you change something that looks arbitrary. It probably is not. |
| `reference/` | You want to see a thing rather than read about it. Open in a browser. |
| `assets/` | Production logo files. Ship as-is. |

## Precedence

When two sources disagree:

1. **`FOUNDATIONS.md` and `DECISIONS.md`** win. They are the rules.
2. **`COMPONENTS.md` / `PATTERNS.md`** win over the reference renders.
3. **The reference renders in `reference/`** are prototypes, not source. They use inline styles and literal hex because of how they were authored; the codebase uses tokens. Lift intent, layout, and measurements from them — never the CSS.
4. **The existing code** is not automatically right. It has drifted from this spec before; `DECISIONS.md` records where and why.

If something here is wrong or missing, say so rather than working around it silently. This spec is maintained, not archaeological.

## The floors — non-negotiable

These come from a real accessibility audit and get re-broken constantly. Full detail in `FOUNDATIONS.md`.

```
44px   minimum interactive target, every axis
12px   minimum interface text
15px   minimum body copy
4.5:1  minimum contrast for small text
```

## How this stays current

Authored and revised in Claude Design, exported here, committed. In the other direction, the design side periodically reads the repo and corrects the spec where the code has moved on — `SITE_SHELL.md` in the handoff package was written that way, after finding the nav had been copy-pasted across 22 pages.

Two consequences worth internalising:

- **Adding a component means adding it here**, not just to `src/components/`. A shared component that is not in `COMPONENTS.md` will be reinvented.
- **Deviating means recording it in `DECISIONS.md`.** An undocumented deviation is indistinguishable from a mistake, and the next agent will "fix" it.

## Multi-repo

This directory is canonical in the web repo. The desktop app, artist node, and MCP server carry copies stamped with the commit they were taken from. When you change something here, note in your commit message which other repos need the copy refreshed.
