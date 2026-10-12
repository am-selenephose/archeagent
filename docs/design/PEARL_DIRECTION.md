# Archeagent / Holographic Obsidian and Mother of Pearl

This document shows real browser captures of the current Next.js UI branch,
not generated static mockups.

## Dark theme: holographic obsidian

![Obsidian desktop](previews/obsidian-desktop.webp)

Full UI surface uses graphite/obsidian, oil-slick lilac, cyan and rose
reflections, subtle slow waves and delicate glass borders.

## Light theme: mother-of-pearl

![Light pearl desktop](previews/pearl-desktop.webp)

Full UI surface is pearlescent ivory with nacre interference waves, muted
lavender/rose/cyan and etched pane-like cards.

## Mobile browser captures

| Dark | Light |
| --- | --- |
| ![Obsidian mobile](previews/obsidian-mobile.webp) | ![Pearl mobile](previews/pearl-mobile.webp) |

## Font approval and licensing

The owner chose AXUNO by VPcreativeshop / Only Fonts for big display headings
and brand typography. The commercial Webfont file is not yet supplied;
screenshots use Jost 300 as a clearly identified fallback, NOT Axuno.
Body copy uses Jost 400. Technical statuses use Geist Mono.
See AXUNO_FONT.md for license and activation details.

## Functional QA

- Actual Next.js production build and ESLint pass.
- 10 focused Vitest tests pass.
- Browser checks: 1440px desktop and 390px mobile.
- Theme toggle persists across reloads.
- No horizontal overflow or page JavaScript errors.
- The previous decorative pearl sphere was removed entirely.
- Existing eval console, API routes and Concord gate remain functional.
- Respect reduced motion. Demo evaluation fixtures are not live model sessions.
