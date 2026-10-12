# Approved Archeagent display face: Axuno

The screenshot reference establishes Axuno by VPcreativeshop / Only Fonts as the
exact intended display font. Its lightweight geometric uppercase letterforms
belong on the brand mark and large headings, not every paragraph.

License not yet provided or verified. Publicly available Axuno Demo is
PERSONAL-USE ONLY. Do not include this demo in GitHub or in a commercial site.

Official Webfont license:
https://creativemarket.com/OnlyFonts/291697596-Axuno-%E2%80%93-Minimal-Elegant-Font

## Current implementation

- CSS declares Axuno with local() detection only. If a licensed copy is
  installed on a preview machine, the genuine Axuno face will render locally.
- Jost 300 is the geometric fallback on all other machines. It is NOT Axuno.
- Jost 400/500 remains the legible text and controls typeface.
- Geist Mono is reserved for technical labels and evidence IDs.
- All prior Instrument Serif / Manrope display styling is removed.
- Display letter spacing stays slightly tight, approximately -0.02 to -0.04em.

## Activation of licensed font

Once the appropriate Webfont licence is purchased and a licensed WOFF2 asset
is supplied, place the WOFF2 in the app's font assets as permitted by license.
Update the src of Axuno font-face in src/app/pearl-theme.css to use its
licensed URL. The font is not bundled before this step. Do not share the font
binary in conversation attachments or publicly without distribution rights.

## Material design update

The decorative pearl ball is removed. Dark mode is holographic obsidian glass
across the interface. Light mode is mother-of-pearl nacre across the interface.
Both use slow surface-wide interference waves and reduced-motion support.
