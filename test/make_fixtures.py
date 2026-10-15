import zipfile, io, struct, zlib, os
def png(w,h,rgb):
    raw=b''.join(b'\x00'+bytes(rgb)*w for _ in range(h))
    def ch(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')
H={k:(k*32)[:32] for k in '123456'}
T=f'Travel Plans {H["1"]}'; D=f'Day 1 Seoul {H["2"]}'; DB=f'Places DB {H["3"]}'; G=f'Gyeongbokgung {H["4"]}'; C=f'Cafe Onion {H["5"]}'; R=f'Reading Notes {H["6"]}'
from urllib.parse import quote as q
md_travel=f"""# Travel Plans

Created: October 1, 2026 9:00 AM
Tags: trip, seoul

Our **autumn** trip to *Seoul* with ~~no~~ `inline code` and a [website](https://example.com/guide).

## Checklist

- [x] Book flights
- [ ] Reserve hotel
    - [ ] Check late checkout

### Order of the day

1. Breakfast
2. Palace
    1. Main hall
3. Cafe

- Bullet one
    - Nested bullet

<aside>
💡 Remember to bring the **T-money** card.

</aside>

> Travel is the only thing you buy that makes you richer.

```javascript
const budget = 500000;
console.log(`Budget: ${{budget}}`);
```

| Item | Cost | Paid |
| --- | --- | --- |
| Hotel | 240,000 | Yes |
| Train | 59,800 | No |

---

![photo.png]({q(T)}/photo.png)

[Day 1 Seoul]({q(T)}/{q(D)}.md)

[Places DB]({q(T)}/{q(DB)}.csv)
"""
md_day=f"""# Day 1 Seoul

Back to [Travel Plans](../{q(T)}.md).

![map.png](map.png)

- [ ] Visit [Gyeongbokgung]({q(DB)}/{q(G)}.md)
"""
csv='Name,Type,Visited\nGyeongbokgung,Palace,Yes\nCafe Onion,Cafe,No\n'
md_g=f"# Gyeongbokgung\n\nType: Palace\nVisited: Yes\n\nThe main royal palace.\n"
md_c=f"# Cafe Onion\n\nType: Cafe\nVisited: No\n\nBread and coffee in Anguk.\n"
md_r=f"# Reading Notes\n\nSee [Day 1](https://www.notion.so/Day-1-Seoul-{H['2']}) for context.\n\n1. First book\n2. Second book\n"
root='Export-7f3e'
z=zipfile.ZipFile('fixtures/notion-md.zip','w')
for path,data in [(f'{T}.md',md_travel),(f'{T}/photo.png',png(64,40,(247,198,208))),(f'{T}/{D}.md',md_day),(f'{T}/{D}/map.png',png(32,32,(191,230,214))),
                  (f'{T}/{DB}.csv',csv),(f'{T}/{DB}_all.csv',csv),(f'{T}/{DB}/{G}.md',md_g),(f'{T}/{DB}/{C}.md',md_c),(f'{R}.md',md_r)]:
    z.writestr(f'{root}/{path}', data)
z.close()
# Notion HTML export (zip-in-zip)
head='<html><head><meta charset="utf-8"/><title>{t}</title><style>/* notion css */</style></head><body><article id="x" class="page sans"><header>{cover}<div class="page-header-icon undefined"><span class="icon">{icon}</span></div><h1 class="page-title">{t}</h1><p class="page-description"></p></header><div class="page-body">{b}</div></article></body></html>'
h_travel=f'''<p id="a">Our <strong>autumn</strong> trip with <code>code</code> and <a href="https://example.com/guide">website</a>.</p>
<h2>Checklist</h2>
<ul id="b" class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Book flights</span></li></ul><ul id="c" class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Reserve hotel</span><div class="indented"><ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Check late checkout</span></li></ul></div></li></ul>
<ol type="1" id="d" class="numbered-list" start="1"><li>Breakfast</li></ol><ol type="1" id="e" class="numbered-list" start="2"><li>Palace</li></ol><ol type="1" id="f" class="numbered-list" start="3"><li>Cafe</li></ol>
<ul id="g" class="bulleted-list"><li style="list-style-type:disc">Bullet one</li></ul>
<ul id="h" class="toggle"><li><details open=""><summary>Packing list</summary><p id="i">Socks and charger</p></details></li></ul>
<figure class="block-color-gray_background callout" style="white-space:pre-wrap;display:flex" id="j"><div style="font-size:1.5em"><span class="icon">💡</span></div><div style="width:100%">Remember the <strong>T-money</strong> card.</div></figure>
<blockquote id="k">Travel makes you richer.</blockquote>
<pre id="l" class="code"><code class="language-JavaScript">const budget = 500000;
console.log(budget);</code></pre>
<table id="m" class="simple-table"><thead class="simple-table-header"><tr><th>Item</th><th>Cost</th></tr></thead><tbody><tr><td>Hotel</td><td>240,000</td></tr></tbody></table>
<hr id="n"/>
<figure id="o" class="image"><a href="{q(T)}/photo.png"><img style="width:640px" src="{q(T)}/photo.png"/></a></figure>
<figure id="p" class="link-to-page"><a href="{q(T)}/{q(D)}.html"><span class="icon">🗓️</span>Day 1 Seoul</a></figure>'''
h_day=f'<p>Back to <a href="../{q(T)}.html">Travel Plans</a>.</p><figure class="image"><a href="{q(D)}/map.png"><img src="{q(D)}/map.png"/></a></figure>'
h_r=f'<p>See <a href="https://www.notion.so/Day-1-Seoul-{H["2"]}">Day 1</a>.</p>'
inner=io.BytesIO(); z=zipfile.ZipFile(inner,'w')
cover=f'<img class="page-cover-image" src="{q(T)}/photo.png" style="object-position:center 50%"/>'
for path,data in [(f'{T}.html',head.format(t='Travel Plans',icon='🧳',cover=cover,b=h_travel)),(f'{T}/photo.png',png(64,40,(247,198,208))),(f'{T}/{D}.html',head.format(t='Day 1 Seoul',icon='🗓️',cover='',b=h_day)),(f'{T}/{D}/map.png',png(32,32,(191,230,214))),(f'{R}.html',head.format(t='Reading Notes',icon='📚',cover='',b=h_r))]:
    z.writestr(path,data)
z.close()
z=zipfile.ZipFile('fixtures/notion-html.zip','w'); z.writestr('Export-7f3e-Part-1.zip',inner.getvalue()); z.close()
open('fixtures/plain.md','w').write("---\nicon: 🍓\n---\n\n# Markdown Sample\n\nHello **world**.\n\n- [ ] todo\n- [x] done\n\n```python\nprint('hi')\n```\n")
print(os.listdir('fixtures'))
