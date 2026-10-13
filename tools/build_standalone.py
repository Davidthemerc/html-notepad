#!/usr/bin/env python3
"""Regenerate the single-file standalone edition from the modular source.

Usage (from the repository root):
    python3 tools/build_standalone.py            # writes "HTML%20Notepad v<ver>.html"
    python3 tools/build_standalone.py --check    # exit 1 if the committed file is stale

Inlines assets/styles.css, concatenates assets/js/*.js in <script> order, and embeds the
192px icon as a data URI. The version comes from APP_VERSION in assets/js/00-core.js.
The output file name keeps a literal "%20" (as earlier releases did).
"""
import base64, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def build():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    version = re.search(r"APP_VERSION\s*=\s*'([^']+)'", (ROOT / 'assets/js/00-core.js').read_text(encoding='utf-8')).group(1)

    html = html.replace('data-build="modular"', 'data-build="standalone"', 1)

    icon = base64.b64encode((ROOT / 'icons/icon-192.png').read_bytes()).decode()
    head_links = re.compile(r'<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*>\n|<link id="appManifest"[^>]*>\n')
    first = head_links.search(html)
    html = head_links.sub('', html)
    html = html[:first.start()] + f'<link rel="icon" type="image/png" href="data:image/png;base64,{icon}" />\n' + html[first.start():]

    # The update-ready banner only applies to the service-worker (modular) build.
    html = re.sub(r'<div id="pwaUpdateNotice".*?</div>\s*</div>\n', '', html, count=1, flags=re.S)

    css = (ROOT / 'assets/styles.css').read_text(encoding='utf-8')
    html = re.sub(r'<link rel="stylesheet" href="\./assets/styles\.css" />', lambda m: f'<style>\n{css}\n</style>', html, count=1)

    srcs = re.findall(r'<script src="\./(assets/js/[^"]+)" defer></script>\n?', html)
    js = '\n'.join((ROOT / s).read_text(encoding='utf-8') for s in srcs)
    html = re.sub(r'(?:<script src="\./assets/js/[^"]+" defer></script>\n?)+', lambda m: f'<script>\n{js}\n</script>\n', html, count=1)
    if 'src="./assets' in html or 'href="./assets' in html:
        raise SystemExit('Unresolved asset reference left in standalone output')
    return version, html


def main():
    version, html = build()
    out = ROOT / f'HTML%20Notepad v{version}.html'.replace(' ', '%20')
    if '--check' in sys.argv:
        if not out.exists() or out.read_text(encoding='utf-8') != html:
            print(f'{out.name} is out of date; run tools/build_standalone.py'); sys.exit(1)
        print(f'{out.name} is up to date'); return
    out.write_text(html, encoding='utf-8')
    print(f'Wrote {out.name} ({len(html):,} bytes)')


if __name__ == '__main__':
    main()
