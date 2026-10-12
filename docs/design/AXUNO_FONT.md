# AXUNO reference and original display font

The exact reference selected by the product owner is AXUNO by
VPcreativeshop / Only Fonts. Its original commercial Webfont binary was not
available on the machine. Simply changing the letter A in proprietary font
software would not eliminate license requirements.

The public design branch therefore includes an independently constructed
and reproducible geometric display face:

- Source: scripts/build-display-font.py
- Output: public/fonts/archeagent-line.ttf
- Face name: Archeagent Line Light
- Primary glyph style: monoline, architectural capitals, tight tracking
- Symbolic A: original split crossbar
- Coverage: 76 mapped ASCII characters, chiefly uppercase and basic
  punctuation/digits, with lowercase mapped to uppercase display forms.

CSS uses an available legitimately installed AXUNO first, then the real
self-hosted Archeagent Line for public rendering, rather than Jost for display.
Jost is still used for readable body text and smaller interactive controls.

If the project owner later supplies the appropriately licensed AXUNO Webfont,
it can be installed without redesigning component typography. The original
AXUNO font and binaries must not be redistributed without the appropriate
permissions. This project-generated font is independently authored and is
not asserted to be the exact original AXUNO.

Official listing:
https://creativemarket.com/OnlyFonts/291697596-Axuno-%E2%80%93-Minimal-Elegant-Font
