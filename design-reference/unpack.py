import json
import base64
import gzip
import re
import os

html_path = r'd:\Infosys project\Community Emergency Response\Community Emergency Response\design-reference\UI_Designs.html'
out_dir = r'd:\Infosys project\Community Emergency Response\Community Emergency Response\design-reference\unpacked'
os.makedirs(out_dir, exist_ok=True)

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

m = re.search(r'<script type="__bundler/manifest">([\s\S]*?)</script>', content)
if m:
    manifest = json.loads(m.group(1))
    print(f'Found {len(manifest)} manifest entries')
    for k, v in manifest.items():
        mime = v.get('mime', '')
        comp = v.get('compressed', False)
        raw_b64 = v.get('data', '')
        if raw_b64:
            b = base64.b64decode(raw_b64)
            if comp:
                b = gzip.decompress(b)
            ext = '.bin'
            if 'html' in mime:
                ext = '.html'
            elif 'css' in mime:
                ext = '.css'
            elif 'javascript' in mime:
                ext = '.js'
            elif 'json' in mime:
                ext = '.json'
            elif 'svg' in mime:
                ext = '.svg'
            elif 'font' in mime or 'woff' in mime:
                ext = '.woff2'
            out_path = os.path.join(out_dir, f'{k}{ext}')
            with open(out_path, 'wb') as out_f:
                out_f.write(b)
            print(f'Wrote {k}{ext} ({len(b)} bytes, {mime})')

t = re.search(r'<script type="__bundler/template">([\s\S]*?)</script>', content)
if t:
    template = json.loads(t.group(1))
    with open(os.path.join(out_dir, 'root_template.html'), 'w', encoding='utf-8') as out_f:
        out_f.write(template)
    print('Wrote root_template.html')

p = re.search(r'<script type="__bundler/page_order">([\s\S]*?)</script>', content)
if p:
    page_order = json.loads(p.group(1))
    print('Page order:', page_order)

for s in [
    '01-login.html',
    '02-resident-dashboard.html',
    '03-incident-tracking.html',
    '04-profile.html',
    '05-mobile-sos.html',
    '06-notifications.html',
    '07-emergency-contacts.html',
    '08-guardian-live-alert.html'
]:
    p = os.path.join(out_dir, s)
    with open(p, 'r', encoding='utf-8') as f:
        c = f.read()
    t = re.search(r'<script type="__bundler/template">([\s\S]*?)</script>', c)
    if t:
        tpl = json.loads(t.group(1))
        out_rendered = os.path.join(out_dir, s.replace('.html', '-rendered.html'))
        with open(out_rendered, 'w', encoding='utf-8') as out_f:
            out_f.write(tpl)
        print(f'Unpacked {s} -> {out_rendered} ({len(tpl)} chars)')

for i in range(1, 9):
    prefix = f'{i:02d}-'
    for f_name in os.listdir(out_dir):
        if f_name.startswith(prefix) and f_name.endswith('-rendered.html'):
            p = os.path.join(out_dir, f_name)
            with open(p, 'r', encoding='utf-8') as fl:
                c = fl.read()
            # find </helmet>
            idx = c.find('</helmet>')
            if idx != -1:
                end_idx = c.find('<script type="text/x-dc"', idx)
                if end_idx == -1:
                    end_idx = c.find('</body>', idx)
                body_content = c[idx + 9:end_idx].strip()
                out_snippet = os.path.join(out_dir, f'screen-{i}-body.html')
                with open(out_snippet, 'w', encoding='utf-8') as out_f:
                    out_f.write(body_content)
                print(f'Screen {i}: wrote body snippet to screen-{i}-body.html ({len(body_content)} chars)')
