#!/usr/bin/env python3
"""Rewrite remote Refex One logo <img> tags to cid:refexone-logo for Outlook-safe MIME.

Used only at email send time (runbook 07). Seed templates / Admin UI preview keep HTTPS URLs.

Does not touch other images (e.g. shimmer GIF dividers).
"""
from __future__ import annotations

import re
import sys

LOGO_SRC_RE = re.compile(
    r"""(?is)(<img\b)([^>]*?\bsrc\s*=\s*["'])https?://[^"']*(?:refexone-logo|refex-logo)\.png(["'])([^>]*>)"""
)

# Outlook Word engine often ignores height:auto — set explicit height when width is known.
WIDTH_RE = re.compile(r"""(?is)\bwidth\s*=\s*["']?(\d+)""")
HEIGHT_ATTR_RE = re.compile(r"""(?is)\bheight\s*=""")


def outlook_height_for_width(width: int) -> int:
    # Source asset is 848×162.
    return max(1, round(width * 162 / 848))


def ensure_height(tag_open: str, mid: str, quote: str, rest: str) -> str:
    attrs = mid + quote + rest
    if HEIGHT_ATTR_RE.search(attrs):
        return tag_open + mid + "cid:refexone-logo" + quote + rest
    m = WIDTH_RE.search(attrs)
    if not m:
        return tag_open + mid + "cid:refexone-logo" + quote + rest
    height = outlook_height_for_width(int(m.group(1)))
    # Insert height immediately after the opening <img
    return f'{tag_open} height="{height}"{mid}cid:refexone-logo{quote}{rest}'


def rewrite(html: str) -> str:
    return LOGO_SRC_RE.sub(
        lambda m: ensure_height(m.group(1), m.group(2), m.group(3), m.group(4)),
        html,
    )


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: rewrite-report-logo-cid.py <report.html>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        html = fh.read()
    out = rewrite(html)
    sys.stdout.write(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
