"""Generates first-person-cursors.png, the cursors a replay draws for the player whose perspective
is shown. Run with `python first-person-cursors.py` (needs Pillow) after changing a shape.

The atlas is a grid of 48x48 cells at 2x scale (96x96 pixels each). Each sprite takes three
consecutive cells, drawn in order:
- under: the dark outline,
- body: white shapes the overlay tints to the player's color,
- over: highlights and the colors that mean something (target rings green/yellow/red for own,
  neutral and enemy, the illegal sign), which stay as they are.

Sprite order (must match `CursorSprite` in first_person.rs):
arrow, illegal, target own/neutral/enemy, hover own/neutral/enemy x HOVER_FRAMES, drag,
scroll up/up-right/right/down-right/down/down-left/left/up-left.
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

CELL = 48            # cell size at 1x
SCALE = 2            # output scale
SS = 8               # supersampling relative to 1x
COLUMNS = 12
HOVER_FRAMES = 12

DARK = (12, 14, 18, 235)
WHITE = (255, 255, 255, 255)
REL = [(64, 230, 96), (240, 210, 60), (240, 64, 56)]   # own, neutral, enemy
ENEMY = REL[2] + (255,)

ARROW_TIP = (6, 6)
CENTER = (24, 24)


def layer():
    return Image.new('RGBA', (CELL * SS, CELL * SS), (0, 0, 0, 0))


def p(points, offset=(0, 0)):
    return [((x + offset[0]) * SS, (y + offset[1]) * SS) for x, y in points]


def finish(img):
    size = CELL * SCALE
    return img.resize((size, size), Image.LANCZOS)


def dilate(img, px):
    return img.filter(ImageFilter.MaxFilter(int(px * SS) * 2 + 1))


ARROW = [(0, 0), (0, 23), (6, 17.5), (10.5, 27), (15, 25), (10.5, 16), (18, 16)]
ARROW_BODY = [(1.6, 3.6), (1.6, 19.8), (6.5, 15.4), (11.2, 24.8), (13.0, 24.0), (8.4, 14.6), (14.6, 14.6)]
ARROW_SHADE = [(1.6, 19.8), (6.5, 15.4), (11.2, 24.8), (13.0, 24.0), (8.4, 14.6), (14.6, 14.6), (4, 10)]


def arrow_layers(illegal=False):
    under, body, over = layer(), layer(), layer()
    outline = layer()
    ImageDraw.Draw(outline).polygon(p(ARROW, ARROW_TIP), fill=DARK)
    under = dilate(outline, 1.2)
    b = ImageDraw.Draw(body)
    b.polygon(p(ARROW_BODY, ARROW_TIP), fill=WHITE)
    shade = layer()
    ImageDraw.Draw(shade).polygon(p(ARROW_SHADE, ARROW_TIP), fill=(150, 150, 150, 255))
    body = Image.alpha_composite(body, Image.composite(shade, layer(), body.split()[3]))
    o = ImageDraw.Draw(over)
    o.line(p([(1.6, 3.6), (1.6, 18.5)], ARROW_TIP), fill=(255, 255, 255, 140), width=int(1.2 * SS))
    if illegal:
        cx, cy, r = ARROW_TIP[0] + 20, ARROW_TIP[1] + 22, 8
        u = ImageDraw.Draw(under)
        a = math.radians(45)
        slash = [(cx - r * math.cos(a), cy - r * math.sin(a)), (cx + r * math.cos(a), cy + r * math.sin(a))]
        u.ellipse(p([(cx - r - 1.5, cy - r - 1.5), (cx + r + 1.5, cy + r + 1.5)]), outline=DARK, width=int(5.5 * SS))
        o.line(p(slash), fill=DARK, width=int(5.5 * SS))
        o.ellipse(p([(cx - r, cy - r), (cx + r, cy + r)]), outline=ENEMY, width=int(2.6 * SS))
        o.line(p(slash), fill=ENEMY, width=int(2.6 * SS))
    return under, body, over


def target_layers(relation, hover_phase=None):
    under, body, over = layer(), layer(), layer()
    u, b, o = ImageDraw.Draw(under), ImageDraw.Draw(body), ImageDraw.Draw(over)
    cx, cy = CENTER
    rx, ry = 13, 8.5
    rel = REL[relation] + (255,)

    def ring(draw, grow, fill, width):
        draw.ellipse(p([(cx - rx - grow, cy - ry - grow), (cx + rx + grow, cy + ry + grow)]),
                     outline=fill, width=int(width * SS))

    ring(u, 1.2, DARK, 4.4)
    ring(o, 0, rel, 2.0)
    for ang in (0, 90, 180, 270):
        a = math.radians(ang)
        tick = [(cx + (rx - 2.5) * math.cos(a), cy + (ry - 2.5) * math.sin(a)),
                (cx + (rx + 3.0) * math.cos(a), cy + (ry + 3.0) * math.sin(a))]
        u.line(p(tick), fill=DARK, width=int(3.6 * SS))
        o.line(p(tick), fill=rel, width=int(1.6 * SS))
    if hover_phase is not None:
        box = p([(cx - rx - 5.5, cy - ry - 5.5), (cx + rx + 5.5, cy + ry + 5.5)])
        for k in range(3):
            start = hover_phase + k * 120
            u.arc(box, start, start + 70, fill=DARK, width=int(4.2 * SS))
            o.arc(box, start + 4, start + 66, fill=rel, width=int(1.8 * SS))
    u.ellipse(p([(cx - 3.2, cy - 3.2), (cx + 3.2, cy + 3.2)]), fill=DARK)
    b.ellipse(p([(cx - 2.0, cy - 2.0), (cx + 2.0, cy + 2.0)]), fill=WHITE)
    return under, body, over


def drag_layers():
    under, body, over = layer(), layer(), layer()
    u, b = ImageDraw.Draw(under), ImageDraw.Draw(body)
    cx, cy = CENTER
    directions = [(0, -1), (0, 1), (-1, 0), (1, 0)]
    for x, y in directions:
        u.line(p([(cx + 3 * x, cy + 3 * y), (cx + 9 * x, cy + 9 * y)]), fill=DARK, width=int(4.2 * SS))
    u.ellipse(p([(cx - 2.2, cy - 2.2), (cx + 2.2, cy + 2.2)]), fill=DARK)
    for x, y in directions:
        b.line(p([(cx + 3.8 * x, cy + 3.8 * y), (cx + 8.2 * x, cy + 8.2 * y)]), fill=WHITE, width=int(2.0 * SS))
    b.ellipse(p([(cx - 1.1, cy - 1.1), (cx + 1.1, cy + 1.1)]), fill=WHITE)
    return under, body, over


def scroll_layers(angle):
    under, body, over = layer(), layer(), layer()
    u, b = ImageDraw.Draw(under), ImageDraw.Draw(body)
    cx, cy = CENTER

    def rot(points):
        a = math.radians(angle)
        return [(cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)) for x, y in points]

    chevron = [(-10, 3), (0, -7), (10, 3), (10, 8), (0, -2), (-10, 8)]
    for off in (-5, 3):
        u.polygon(p(rot([(x, y + off) for x, y in chevron])), fill=DARK)
    for off in (-5, 3):
        b.polygon(p(rot([(x * 0.82, y * 0.82 + off) for x, y in chevron])), fill=WHITE)
    return under, body, over


def sprites():
    yield arrow_layers()
    yield arrow_layers(illegal=True)
    for relation in range(3):
        yield target_layers(relation)
    for relation in range(3):
        for frame in range(HOVER_FRAMES):
            yield target_layers(relation, hover_phase=frame * 120 / HOVER_FRAMES)
    yield drag_layers()
    for direction in range(8):
        yield scroll_layers(direction * 45)


def main():
    cells = [finish(img) for layers in sprites() for img in layers]
    size = CELL * SCALE
    rows = (len(cells) + COLUMNS - 1) // COLUMNS
    atlas = Image.new('RGBA', (COLUMNS * size, rows * size), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        atlas.alpha_composite(cell, ((i % COLUMNS) * size, (i // COLUMNS) * size))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'first-person-cursors.png')
    atlas.save(out, optimize=True)
    print(f'{len(cells) // 3} sprites, {atlas.size[0]}x{atlas.size[1]} -> {out}')


main()
