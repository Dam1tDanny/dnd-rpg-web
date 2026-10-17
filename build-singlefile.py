#!/usr/bin/env python3
"""Build dnd-rpg-web-alpha.html: inline dist-singlefile assets into one file.

The JS and CSS are inlined BYTE-IDENTICAL. The only transformation forbidden
here is the naive `</` -> `<\\/` replacement a previous manual build used --
it corrupts regex literals like /</g (turning them into /<\\//g, which breaks
parsing) and shipped a completely blank game. We assert instead: if the JS
contains a literal `</script` (or CSS contains `</style`), fail loudly rather
than silently corrupting the bundle.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"  # standard `npm run build` output
OUT = ROOT / "dnd-rpg-web-alpha.html"


def main() -> None:
    html_path = DIST / "index.html"
    html = html_path.read_text(encoding="utf-8")

    scripts = re.findall(r'<script[^>]*src="([^"]+)"[^>]*></script>', html)
    links = re.findall(r'<link[^>]*href="([^"]+)"[^>]*>', html)
    if len(scripts) != 1:
        sys.exit(f"expected exactly 1 script src, found {scripts}")
    if len(links) != 1:
        sys.exit(f"expected exactly 1 stylesheet href, found {links}")

    js = (DIST / scripts[0].lstrip("./")).read_bytes()
    css = (DIST / links[0].lstrip("./")).read_bytes()

    if b"</script" in js.lower():
        sys.exit("refusing to inline: JS contains literal </script")
    if b"</style" in css.lower():
        sys.exit("refusing to inline: CSS contains literal </style")

    js_tag = '<script type="module">\n' + js.decode("utf-8") + "\n</script>"
    css_tag = "<style>\n" + css.decode("utf-8") + "\n</style>"

    html = re.sub(
        r'<script[^>]*src="[^"]+"[^>]*></script>', lambda _: js_tag, html, count=1
    )
    html = re.sub(r'<link[^>]*href="[^"]+"[^>]*>', lambda _: css_tag, html, count=1)

    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
