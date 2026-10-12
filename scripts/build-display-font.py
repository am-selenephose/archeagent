#!/usr/bin/env python3
"""Build Archeagent's original geometric light display font from primitive paths.

Every glyph skeleton is authored here from strokes and curves; no third-party
font outlines, binaries or glyph tables are incorporated.
"""
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from pathlib import Path
from math import sin, cos, pi, hypot

OUT = Path(__file__).resolve().parent.parent / "public/fonts/archeagent-line.ttf"
STROKE = 18
glyphs = {}
advance = {}
cmap = {}


def signed_area(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1]
               - poly[(i + 1) % len(poly)][0] * poly[i][1]
               for i in range(len(poly)))


def contour(pen, coords, clockwise=True):
    if len(coords) < 3:
        return
    pts = coords if (signed_area(coords) < 0) == clockwise else list(reversed(coords))
    pen.moveTo((round(pts[0][0]), round(pts[0][1])))
    for x, y in pts[1:]:
        pen.lineTo((round(x), round(y)))
    pen.closePath()


def stroke(pen, points, thickness=STROKE):
    if len(points) < 2:
        return
    half = thickness / 2
    normals = []
    for a, b in zip(points[:-1], points[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        norm = hypot(dx, dy)
        if norm < 0.001:
            raise ValueError("duplicate consecutive points")
        normals.append((-dy / norm, dx / norm))
    left, right = [], []
    for index, (x, y) in enumerate(points):
        if index == 0:
            nx, ny = normals[0]
            scale = half
        elif index == len(points) - 1:
            nx, ny = normals[-1]
            scale = half
        else:
            ax, ay = normals[index - 1]
            bx, by = normals[index]
            nx, ny = ax + bx, ay + by
            norm = hypot(nx, ny)
            if norm < .005:
                nx, ny, scale = bx, by, half
            else:
                nx, ny = nx / norm, ny / norm
                dot = abs(nx * bx + ny * by)
                scale = min(half / max(dot, .45), half * 2.0)
        left.append((x + nx * scale, y + ny * scale))
        right.append((x - nx * scale, y - ny * scale))
    contour(pen, left + right[::-1])


def elliptic(cx, cy, rx, ry, start=0, end=2 * pi, steps=70):
    return [(cx + rx * cos(start + (end - start) * i / steps),
             cy + ry * sin(start + (end - start) * i / steps))
            for i in range(steps + 1)]


def bezier(a, b, c, d, steps=18):
    points = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        points.append((
            u*u*u*a[0] + 3*u*u*t*b[0] + 3*u*t*t*c[0] + t*t*t*d[0],
            u*u*u*a[1] + 3*u*u*t*b[1] + 3*u*t*t*c[1] + t*t*t*d[1],
        ))
    return points


def add(char, paths, width=690):
    p = TTGlyphPen(None)
    for path in paths:
        stroke(p, path)
    name = f"uni{ord(char):04X}"
    glyphs[name] = p.glyph()
    advance[name] = (width, 0)
    cmap[ord(char)] = name


def ring(char, cx=345, cy=340, rx=275, ry=330, width=690):
    p = TTGlyphPen(None)
    contour(p, elliptic(cx, cy, rx + STROKE / 2, ry + STROKE / 2)[:-1], clockwise=True)
    contour(p, elliptic(cx, cy, rx - STROKE / 2, ry - STROKE / 2)[:-1], clockwise=False)
    name = f"uni{ord(char):04X}"
    glyphs[name] = p.glyph()
    advance[name] = (width, 0)
    cmap[ord(char)] = name


def copy_glyph(char, original):
    cmap[ord(char)] = cmap[ord(original)]


# A deliberately distinct, split-bar compass-like A mark is not a glyph
# alteration to another font. All letter contours here are independently built.
add("A", [[(88, 0), (336, 672), (584, 0)],
          [(176, 235), (304, 235)], [(368, 235), (496, 235)]])
add("B", [[(100, 0), (100, 672)],
          elliptic(103, 505, 255, 167, pi / 2, -pi / 2, 32),
          elliptic(103, 167, 255, 167, pi / 2, -pi / 2, 32)])
add("C", [elliptic(347, 337, 277, 331, .78, 2*pi - .78, 62)])
add("D", [[(104, 0), (104, 672)],
          elliptic(104, 336, 475, 336, pi/2, -pi/2, 55)])
add("E", [[(100, 0), (100, 672)], [(100, 672), (580, 672)],
          [(100, 337), (508, 337)], [(100, 0), (580, 0)]])
add("F", [[(100, 0), (100, 672)], [(100, 672), (580, 672)],
          [(100, 337), (508, 337)]])
add("G", [elliptic(350, 337, 275, 332, .72, 2*pi-.48, 66),
          [(595, 225), (405, 225)]])
add("H", [[(100, 0), (100, 672)], [(590, 0), (590, 672)],
          [(100, 337), (590, 337)]])
add("I", [[(140, 0), (140, 672)]], width=280)
add("J", [[(570, 672), (570, 185)] +
          elliptic(350, 185, 220, 176, 0, -pi, 40)[1:]], width=700)
add("K", [[(104, 0), (104, 672)],
          [(595, 672), (104, 267)], [(325, 457), (607, 0)]])
add("L", [[(105, 672), (105, 0), (572, 0)]])
add("M", [[(88, 0), (88, 672), (395, 168), (702, 672), (702, 0)]], width=790)
add("N", [[(100, 0), (100, 672), (590, 0), (590, 672)]])
ring("O")
add("P", [[(105, 0), (105, 672)],
          elliptic(105, 500, 450, 172, pi/2, -pi/2, 37)], width=685)
ring("Q")
# Re-build Q by adding a diagonal stroke atop the original ring contours.
qp = TTGlyphPen(None)
contour(qp, elliptic(345, 340, 284, 339)[:-1], clockwise=True)
contour(qp, elliptic(345, 340, 266, 321)[:-1], clockwise=False)
stroke(qp, [(475, 128), (646, -44)])
glyphs[cmap[ord("Q")]] = qp.glyph()
add("R", [[(105, 0), (105, 672)],
          elliptic(105, 500, 450, 172, pi/2, -pi/2, 37),
          [(350, 325), (620, 0)]], width=700)
s = (bezier((560, 575),(390, 720),(120, 670),(120, 499), 23)
     + bezier((120, 499),(120, 335),(555, 422),(560, 267), 23)[1:]
     + bezier((560, 267),(565, 95),(365, -72),(125, 99), 25)[1:])
add("S", [s])
add("T", [[(68, 672), (625, 672)], [(346, 672), (346, 0)]])
u = ([(115, 672), (115, 177)] +
     elliptic(345, 177, 230, 169, pi, 2*pi, 43)[1:] +
     [(575, 672)])
add("U", [u])
add("V", [[(68, 672), (345, 0), (622, 672)]])
add("W", [[(65, 672), (215, 0), (435, 460), (655, 0), (805, 672)]], width=870)
add("X", [[(85, 672), (595, 0)], [(595, 672), (85, 0)]])
add("Y", [[(80, 672), (340, 342), (600, 672)],
          [(340, 342), (340, 0)]])
add("Z", [[(90, 672), (595, 672), (90, 0), (595, 0)]])

copy_glyph("0", "O")
add("1", [[(135, 540), (330, 672), (330, 0)]])
add("2", [bezier((110, 498),(120, 720),(565, 760),(562, 475), 40) +
          bezier((562, 475),(562, 323),(325, 209),(105, 0), 28)[1:],
          [(105, 0), (575, 0)]])
add("3", [bezier((120, 589),(375, 760),(637, 535),(315, 338), 38) +
          bezier((315, 338),(630, 320),(665, 20),(120, 89), 38)[1:]])
add("4", [[(510, 0), (510, 672)], [(510, 190), (95, 190), (410, 672)]])
add("5", [[(570, 672), (145, 672), (145, 350)],
          bezier((145, 350),(610, 495),(720, -26),(130, 85), 42)])
add("6", [elliptic(347, 209, 254, 207, pi * .93, 2*pi + pi * .93, 60),
          [(600, 605), (200, 350)]])
add("7", [[(95, 672), (590, 672), (240, 0)]])
add("8", [elliptic(345, 499, 216, 173, 0, 2*pi, 58),
          elliptic(345, 168, 251, 170, 0, 2*pi, 58)])
add("9", [elliptic(340, 470, 250, 202, 0, 2*pi, 56),
          [(570, 354), (430, 0)]])

# Basic punctuation and useful UI symbols.
add("-", [[(105, 321), (480, 321)]], width=580)
add("_", [[(80, -60), (495, -60)]], width=585)
add("+", [[(95, 320), (535, 320)], [(315, 95), (315, 540)]], width=630)
add("/", [[(78, -85), (545, 695)]], width=610)
add("\\", [[(78, 695), (545, -85)]], width=610)
add(".", [[(92, 0), (93, 1)]], width=245)
add(":", [[(92, 0), (93, 1)], [(92, 370), (93, 371)]], width=245)
add("!", [[(140, 155), (140, 672)], [(140, 0), (141, 1)]], width=280)
add("?", [bezier((95, 488),(70, 715),(535, 743),(555, 520), 33) +
          bezier((555, 520),(555, 370),(333, 356),(333, 182), 25)[1:],
          [(333, 0), (334, 1)]])
add(",", [[(145, 15), (100, -95)]], width=230)
add("(", [elliptic(310, 335, 210, 390, pi * .39, pi * 1.61, 48)], width=390)
add(")", [elliptic(80, 335, 210, 390, -pi * .61, pi * .61, 48)], width=390)
add("=", [[(90, 410), (535, 410)], [(90, 250), (535, 250)]], width=630)

# Leave space width under control: AXUNO reference had more spacing than the
# requested Archeagent layout, so spacing is deliberately tuned tighter.
space_pen = TTGlyphPen(None)
glyphs["space"] = space_pen.glyph()
advance["space"] = (278, 0)
cmap[32] = "space"
notdef = TTGlyphPen(None)
contour(notdef, [(60, 0), (60, 670), (570, 670), (570, 0)])
glyphs[".notdef"] = notdef.glyph()
advance[".notdef"] = (640, 0)

# Map lowercase ASCII to independently generated uppercase outlines for
# display-only use. UI/body copy uses its separate readable font.
for letter in "abcdefghijklmnopqrstuvwxyz":
    copy_glyph(letter, letter.upper())

order = [".notdef", "space"] + sorted(k for k in glyphs if k not in (".notdef", "space"))
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap(cmap)
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics(advance)
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, sTypoLineGap=0,
            usWinAscent=820, usWinDescent=220, sxHeight=470, sCapHeight=680,
            usWeightClass=300)
fb.setupNameTable({
    "familyName": "Archeagent Line",
    "styleName": "Light",
    "uniqueFontIdentifier": "ArcheagentLine-Light-20261012",
    "fullName": "Archeagent Line Light",
    "psName": "ArcheagentLine-Light",
    "version": "Version 1.000",
    "description": "Original thin geometric display face created for Archeagent.",
})
fb.setupPost()
fb.setupMaxp()
fb.setupHead()
OUT.parent.mkdir(parents=True, exist_ok=True)
fb.save(str(OUT))
font = TTFont(OUT)
font.close()
print("FONT_BUILT", OUT, OUT.stat().st_size, "bytes", len(cmap), "mapped characters")
