#!/usr/bin/env python3
"""Markdown -> bilingual HTML with an EN/JA language toggle (AAC test plan).
Each bilingual string is written  English ‖ 日本語  in the source; this emits
<span lang="en">…</span><span lang="ja">…</span> and a toggle that hides the
inactive language via CSS (body.lang-xx [lang=yy]{display:none}).
Handles: # ## ### headings, GFM tables, ``` code fences, **bold**, `code`,
--- rules, blank-line paragraphs. Dependency-free."""
import html, re

SRC = "/Users/thinksound/AAC/aac_validation_test_plan.md"
OUT = "/Users/thinksound/AAC/aac_validation_test_plan.html"
SEP = "‖"  # ‖

def fmt(t):
    """Inline markdown -> HTML (escape, then `code` and **bold**)."""
    t = html.escape(t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    return t

def bil(text):
    """Render a possibly-bilingual run. If it contains the ‖ separator, emit
    per-language spans; otherwise emit it as-is (shown in both languages)."""
    if SEP in text:
        en, ja = (p.strip() for p in text.split(SEP, 1))
        return f'<span lang="en">{fmt(en)}</span><span lang="ja">{fmt(ja)}</span>'
    return fmt(text)

def main():
    with open(SRC, encoding="utf-8") as f:
        lines = f.read().split("\n")

    out, i, n = [], 0, len(lines)
    while i < n:
        line = lines[i]

        if line.startswith("```"):
            buf = []
            i += 1
            while i < n and not lines[i].startswith("```"):
                buf.append(html.escape(lines[i]))
                i += 1
            i += 1
            out.append("<pre><code>" + "\n".join(buf) + "</code></pre>")
            continue

        if line.strip() == "---":
            out.append("<hr>")
            i += 1
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{bil(m.group(2))}</h{lvl}>")
            i += 1
            continue

        if line.lstrip().startswith("|") and i + 1 < n and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            def cells(row):
                return [c.strip() for c in row.strip().strip("|").split("|")]
            header = cells(line)
            i += 2
            rows = []
            while i < n and lines[i].lstrip().startswith("|"):
                rows.append(cells(lines[i]))
                i += 1
            t = ["<table><thead><tr>"]
            t += [f"<th>{bil(c)}</th>" for c in header]
            t.append("</tr></thead><tbody>")
            for r in rows:
                t.append("<tr>" + "".join(f"<td>{bil(c)}</td>" for c in r) + "</tr>")
            t.append("</tbody></table>")
            out.append("".join(t))
            continue

        if line.strip() == "":
            i += 1
            continue

        buf = [line]
        i += 1
        while i < n and lines[i].strip() != "" and not lines[i].startswith(("#", "|", "```", "---")):
            buf.append(lines[i])
            i += 1
        out.append("<p>" + bil(" ".join(buf)) + "</p>")

    body = "\n".join(out)
    doc = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AAC Audio Front-End — Validation Test Plan</title>
<style>
  :root { --aac:#1f5066; --line:#d8dee3; --bg:#f6f8f9; --muted:#64748b; }
  * { box-sizing:border-box; }
  body { font-family:-apple-system,"Segoe UI","Hiragino Sans","Yu Gothic",system-ui,sans-serif;
         color:#1c2733; line-height:1.55; max-width:1080px; margin:0 auto; padding:0 32px 80px; }
  h1 { font-size:24px; color:var(--aac); border-bottom:3px solid var(--aac); padding-bottom:8px; margin:28px 0 4px; }
  h2 { font-size:19px; color:var(--aac); margin-top:34px; border-left:5px solid var(--aac); padding-left:10px; }
  h3 { font-size:16px; color:#2c3e50; margin-top:24px; }
  p { margin:10px 0; }
  hr { border:0; border-top:1px solid var(--line); margin:26px 0; }
  code { background:var(--bg); padding:1px 5px; border-radius:4px; font-family:"SF Mono",Menlo,Consolas,monospace; font-size:0.88em; }
  pre { background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:14px 16px; overflow-x:auto; font-size:12px; line-height:1.4; }
  pre code { background:none; padding:0; }
  table { border-collapse:collapse; width:100%; margin:16px 0; font-size:12.5px; }
  th, td { border:1px solid var(--line); padding:7px 9px; text-align:left; vertical-align:top; }
  th { background:var(--aac); color:#fff; font-weight:600; }
  tbody tr:nth-child(even) { background:var(--bg); }
  strong { color:#0f2a38; }
  /* language toggle */
  .langbar { position:sticky; top:0; z-index:50; display:flex; justify-content:flex-end;
             gap:8px; align-items:center; padding:10px 0; margin-bottom:4px;
             background:rgba(255,255,255,.92); backdrop-filter:blur(6px);
             border-bottom:1px solid var(--line); }
  .langbar .lbl { font-size:12px; color:var(--muted); margin-right:auto; }
  .langbar button { cursor:pointer; border:1px solid var(--aac); background:transparent;
                    color:var(--aac); border-radius:7px; padding:5px 14px; font-size:13px; font-weight:600; }
  body.lang-en #enBtn, body.lang-ja #jaBtn { background:var(--aac); color:#fff; }
  body.lang-en [lang=ja] { display:none !important; }
  body.lang-ja [lang=en] { display:none !important; }
  @media print {
    .langbar { display:none; }
    body { padding:0; font-size:11px; }
    h1,h2,h3 { page-break-after:avoid; }
    table, pre { page-break-inside:avoid; }
    thead { display:table-header-group; }
  }
</style>
</head>
<body class="lang-en">
<div class="langbar">
  <span class="lbl">Language / 言語</span>
  <button id="enBtn" onclick="setLang('en')">EN</button>
  <button id="jaBtn" onclick="setLang('ja')">日本語</button>
</div>
""" + body + """
<script>
  function setLang(l){
    document.body.classList.toggle('lang-en', l==='en');
    document.body.classList.toggle('lang-ja', l==='ja');
    document.documentElement.lang = l;
    try{ localStorage.setItem('aac-tp-lang', l); }catch(e){}
  }
  var saved='en';
  try{ saved = localStorage.getItem('aac-tp-lang')
        || ((navigator.language||'').toLowerCase().indexOf('ja')===0 ? 'ja':'en'); }catch(e){}
  setLang(saved);
</script>
</body>
</html>"""
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(doc)
    print("wrote", OUT)

if __name__ == "__main__":
    main()
