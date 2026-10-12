# Archeagent / AXUNO Full-Screen Living Material Preview

This is a LOCAL PRIVATE worktree preview of Archeagent, not the public app.
It uses the original downloaded Axuno Demo OpenType family locally. The
font archive's 1001Fonts Free For Personal Use license does not authorize
commercial publishing, modification or distribution. The font binary is
excluded from Git and must not be pushed to a public repository.

Working directory: /home/nur/Projects/archeagent-axuno-exact-preview
Local preview address: http://localhost:34683

## UX implementation

- main, sticky navigation and hero now use the entire viewport width;
  there is no bounding slab around the content.
- Obsidian is a translucent near-black material with shifting holographic
  lavender, cyan and rose light.
- Mother-of-pearl is full-screen ivory with genuinely animated nacre bands.
- Three GPU-transforming ribbon layers and two ambient blooms move
  continuously, changing the interference colors across the viewport.
- Fixed material remains animated while scrolling, including verification
  panels. Reduced-motion preference disables all ambient animations.
- AXUNO is used for all UI letters from the original demo font.
  Digits and punctuation fall back where the demo has no glyphs.
- Larger readable navigation, body, console, capabilities, lifecycle status,
  and responsive typography. Spacing was opened slightly.
- Mother-of-pearl uses blue-charcoal ink for primary content, with
  readable secondary blues, not white-on-light pastel text.
- The original model evaluation routes, theme switch, and lifecycle
  interactions remain functional. No new backend behavior is claimed.

## Verified locally

- pnpm lint
- pnpm build
- vitest 10/10 focused tests
- Chrome/Playwright checks at 390px, 768px, 1440px and 1920px
- Full width with no horizontal overflow
- Theme switching, localStorage persistence and 12-stage lifecycle rendering
- Three active color-shifting CSS wave ribbons
- Screenshot comparison during mid-page scrolling: real pixel differences
  across frames for both dark and light themes
- Reduced-motion media preference disables ambient animations
- Zero page JavaScript errors
- Screenshots are local under /tmp/immersive-*, not published with demo font

## Important publication boundary

Do NOT push the downloaded Axuno demo font binary to GitHub or deploy this
preview publicly. A licensed original webfont asset is needed before a public
or commercial deployment. The CSS+layout changes are locally committed
here for review, not merged into the public Archeagent branch.
