"""Fixed X11 indicator helper. stdin accepts bounded JSON show/pulse/hide/quit messages."""
import ctypes as C
import math
import json
import locale
import os
import select
import sys
import time

class Rectangle(C.Structure):
    _fields_ = [("x", C.c_short), ("y", C.c_short), ("width", C.c_ushort), ("height", C.c_ushort)]

class Attributes(C.Structure):
    _fields_ = [("background_pixmap", C.c_ulong), ("background_pixel", C.c_ulong),
                ("border_pixmap", C.c_ulong), ("border_pixel", C.c_ulong),
                ("bit_gravity", C.c_int), ("win_gravity", C.c_int),
                ("backing_store", C.c_int), ("backing_planes", C.c_ulong),
                ("backing_pixel", C.c_ulong), ("save_under", C.c_int),
                ("event_mask", C.c_long), ("do_not_propagate_mask", C.c_long),
                ("override_redirect", C.c_int), ("colormap", C.c_ulong), ("cursor", C.c_ulong)]


class RenderColor(C.Structure):
    _fields_ = [("red", C.c_ushort), ("green", C.c_ushort), ("blue", C.c_ushort), ("alpha", C.c_ushort)]

class XftColor(C.Structure):
    _fields_ = [("pixel", C.c_ulong), ("color", RenderColor)]

class GlyphInfo(C.Structure):
    _fields_ = [("width", C.c_ushort), ("height", C.c_ushort), ("x", C.c_short), ("y", C.c_short), ("xOff", C.c_short), ("yOff", C.c_short)]


def bind(lib, name, result, *args):
    fn = getattr(lib, name)
    fn.restype, fn.argtypes = result, args
    return fn


def main():
    locale.setlocale(locale.LC_ALL, "")
    xft = C.CDLL("libXft.so.2")
    x = C.CDLL("libX11.so.6")
    ext = C.CDLL("libXext.so.6")
    ptr, ul, integer = C.c_void_p, C.c_ulong, C.c_int
    open_display = bind(x, "XOpenDisplay", ptr, C.c_char_p)
    display = open_display(None)
    if not display:
        raise RuntimeError("Cannot open X11 display")
    root = bind(x, "XDefaultRootWindow", ul, ptr)(display)
    shape_supported = bind(ext, "XShapeQueryExtension", integer, ptr, C.POINTER(integer), C.POINTER(integer))
    event, error = integer(), integer()
    if not shape_supported(display, C.byref(event), C.byref(error)):
        raise RuntimeError("X11 SHAPE extension is unavailable")
    shape_version = bind(ext, "XShapeQueryVersion", integer, ptr, C.POINTER(integer), C.POINTER(integer))
    major, minor = integer(), integer()
    shape_version(display, C.byref(major), C.byref(minor))
    if (major.value, minor.value) < (1, 1):
        raise RuntimeError("X11 SHAPE 1.1 is required for click-through input")
    create = bind(x, "XCreateSimpleWindow", ul, ptr, ul, integer, integer, C.c_uint, C.c_uint, C.c_uint, ul, ul)
    window = create(display, root, 0, 0, 540, 72, 0, 0, 0x10262B)
    change = bind(x, "XChangeWindowAttributes", integer, ptr, ul, ul, C.POINTER(Attributes))
    attributes = Attributes()
    attributes.override_redirect = 1
    change(display, window, 1 << 9, C.byref(attributes))
    bind(x, "XStoreName", integer, ptr, ul, C.c_char_p)(display, window, b"CLUI cursor indicator")
    atom = bind(x, "XInternAtom", ul, ptr, C.c_char_p, integer)
    property_ = bind(x, "XChangeProperty", integer, ptr, ul, ul, ul, integer, integer, ptr, integer)
    window_type = ul(atom(display, b"_NET_WM_WINDOW_TYPE_DND", 0))
    property_(display, window, atom(display, b"_NET_WM_WINDOW_TYPE", 0), 4, 32, 0, C.byref(window_type), 1)
    shape = bind(ext, "XShapeCombineRectangles", None, ptr, ul, integer, integer, integer, C.POINTER(Rectangle), integer, integer, integer)
    # An empty input shape lets every mouse event reach the application underneath.
    shape(display, window, 2, 0, 0, None, 0, 0, 0)
    shape(display, window, 0, 0, 0, None, 0, 0, 0)
    gc = bind(x, "XCreateGC", ptr, ptr, ul, ul, ptr)(display, window, 0, None)
    foreground = bind(x, "XSetForeground", integer, ptr, ptr, ul)
    fill = bind(x, "XFillRectangles", integer, ptr, ul, ptr, C.POINTER(Rectangle), integer)
    screen = bind(x, "XDefaultScreen", integer, ptr)(display)
    visual = bind(x, "XDefaultVisual", ptr, ptr, integer)(display, screen)
    colormap = bind(x, "XDefaultColormap", ul, ptr, integer)(display, screen)
    font = bind(xft, "XftFontOpenName", ptr, ptr, integer, C.c_char_p)(display, screen, b"DejaVu Sans:size=10")
    if not font:
        raise RuntimeError("Cannot load indicator font")
    text_draw = bind(xft, "XftDrawCreate", ptr, ptr, ul, ptr, ul)(display, window, visual, colormap)
    text_color = XftColor()
    color = RenderColor(0x5E5E, 0xEAEA, 0xD4D4, 0xFFFF)
    if not bind(xft, "XftColorAllocValue", integer, ptr, ptr, ul, C.POINTER(RenderColor), C.POINTER(XftColor))(display, visual, colormap, C.byref(color), C.byref(text_color)):
        raise RuntimeError("Cannot allocate indicator text color")
    measure = bind(xft, "XftTextExtentsUtf8", None, ptr, ptr, C.c_char_p, integer, C.POINTER(GlyphInfo))
    draw_text = bind(xft, "XftDrawStringUtf8", None, ptr, C.POINTER(XftColor), ptr, integer, integer, C.c_char_p, integer)
    resize = bind(x, "XResizeWindow", integer, ptr, ul, C.c_uint, C.c_uint)
    screen_width = bind(x, "XDisplayWidth", integer, ptr, integer)(display, screen)

    has_character = bind(xft, "XftCharExists", integer, ptr, ptr, C.c_uint)

    def fit_label(label):
        if not has_character(display, font, ord("→")):
            label = label.replace("→", ">")
        label = label[:120]
        while label:
            encoded = label.encode("utf-8")
            size = GlyphInfo()
            measure(display, font, encoded, len(encoded), C.byref(size))
            if size.xOff <= 430:
                return encoded, max(80, size.xOff + 20)
            label = label[:-2] + "…"
        return b"", 80
    move = bind(x, "XMoveWindow", integer, ptr, ul, integer, integer)
    show = bind(x, "XMapRaised", integer, ptr, ul)
    hide = bind(x, "XUnmapWindow", integer, ptr, ul)
    raise_ = bind(x, "XRaiseWindow", integer, ptr, ul)
    flush = bind(x, "XFlush", integer, ptr)
    query = bind(x, "XQueryPointer", integer, ptr, ul, C.POINTER(ul), C.POINTER(ul), C.POINTER(integer), C.POINTER(integer), C.POINTER(integer), C.POINTER(integer), C.POINTER(C.c_uint))
    root_return, child_return = ul(), ul()
    rx, ry, wx, wy, mask = integer(), integer(), integer(), integer(), C.c_uint()
    visible = False
    expires = pulse_at = 0.0
    pending = b""
    label = "Ожидание следующего действия"
    label_bytes, label_width = fit_label(label)
    print("ready", flush=True)
    try:
        while True:
            readable, _, _ = select.select([sys.stdin.buffer], [], [], 1 / 30 if visible else 1)
            now = time.monotonic()
            if readable:
                chunk = os.read(sys.stdin.fileno(), 4096)
                if not chunk:
                    break
                pending += chunk
                if len(pending) > 8192:
                    raise RuntimeError("Indicator command buffer exceeded")
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    try:
                        message = json.loads(line.decode("utf-8"))
                    except (ValueError, UnicodeError):
                        continue
                    if not isinstance(message, dict):
                        continue
                    command = message.get("command")
                    next_label = message.get("label")
                    if isinstance(next_label, str) and next_label != label:
                        label = " ".join(next_label.split())[:120]
                        label_bytes, label_width = fit_label(label)
                    if command == "quit":
                        return
                    if command in ("show", "pulse"):
                        expires = now + 6
                        if command == "pulse":
                            pulse_at = now
                        if not visible:
                            show(display, window)
                            visible = True
                    elif command == "hide":
                        hide(display, window)
                        visible = False
            if visible and now >= expires:
                hide(display, window)
                visible = False
            if visible:
                query(display, root, C.byref(root_return), C.byref(child_return), C.byref(rx), C.byref(ry), C.byref(wx), C.byref(wy), C.byref(mask))
                # Keep the label on-screen near the right edge without moving the ring off the pointer.
                width = label_width + 70
                left = rx.value + label_width + 40 > screen_width and rx.value >= label_width + 36
                center_x = width - 36 if left else 36
                label_x = 8 if left else 62
                resize(display, window, width, 72)
                move(display, window, rx.value - center_x, ry.value - 36)
                age = now - pulse_at
                radius = 18 + (12 * age / .4 if 0 <= age < .4 else 0)
                rectangles = []
                for y in range(-32, 33):
                    outer = int(math.sqrt(max(0, radius * radius - y * y))) if abs(y) <= radius else 0
                    inner_radius = radius - 3
                    inner = int(math.sqrt(max(0, inner_radius * inner_radius - y * y))) if abs(y) < inner_radius else 0
                    if outer:
                        if inner:
                            rectangles.extend([Rectangle(center_x - outer, 36 + y, outer - inner, 1), Rectangle(center_x + inner, 36 + y, outer - inner, 1)])
                        else:
                            rectangles.append(Rectangle(center_x - outer, 36 + y, 2 * outer, 1))
                ring = (Rectangle * len(rectangles))(*rectangles)
                all_rectangles = (Rectangle * (len(rectangles) + 1))(*rectangles, Rectangle(label_x, 22, label_width, 28))
                shape(display, window, 0, 0, 0, all_rectangles, len(all_rectangles), 0, 0)
                foreground(display, gc, 0x10262B)
                fill(display, window, gc, all_rectangles, len(all_rectangles))
                foreground(display, gc, 0xFFFFFF if 0 <= age < .4 else 0x5EEAD4)
                fill(display, window, gc, ring, len(ring))
                foreground(display, gc, 0x5EEAD4)
                draw_text(text_draw, C.byref(text_color), font, label_x + 10, 41, label_bytes, len(label_bytes))
                raise_(display, window)
            flush(display)
    finally:
        bind(xft, "XftDrawDestroy", None, ptr)(text_draw)
        bind(xft, "XftFontClose", None, ptr, ptr)(display, font)
        bind(xft, "XftColorFree", None, ptr, ptr, ul, C.POINTER(XftColor))(display, visual, colormap, C.byref(text_color))
        bind(x, "XFreeGC", integer, ptr, ptr)(display, gc)
        bind(x, "XDestroyWindow", integer, ptr, ul)(display, window)
        bind(x, "XCloseDisplay", integer, ptr)(display)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
