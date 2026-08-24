# CLAUDE.md — Lightning FM Desktop

Tauri v2 desktop app (Vite + React frontend, Rust backend). When this repo is checked out inside the eeg working tree, the parent `lightning-fm/CLAUDE.md` also applies; this file is what a standalone clone gets.

## Design system

Before writing or changing any UI, read `design-system/`:

- `design-system/FOUNDATIONS.md` — tokens, type scale, spacing, the accessibility floors. Always.
- `design-system/COMPONENTS.md` — before building or touching a shared component.
- `design-system/PATTERNS.md` — before laying out a page or deciding what gets emphasis.
- `design-system/DECISIONS.md` — before changing something that looks arbitrary. It probably is not.

**This directory outranks your instincts about spacing, colour, and type size.** Use the CSS custom properties from `src/globals.css`, never literal hex. Border radius is zero everywhere. Minimum 44px interactive targets, 12px interface text, 15px body copy.

The files in `design-system/reference/` are HTML prototypes — open them to see intent, but never copy their inline styles into the codebase.

If the spec is wrong or missing something, say so rather than working around it silently.

`design-system/` here is a stamped copy (source commit in its README). The canonical spec lives in the web repo; refresh the copy rather than editing it.
