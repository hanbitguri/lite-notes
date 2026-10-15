import sys, json
from playwright.sync_api import sync_playwright
eng=sys.argv[1] if len(sys.argv)>1 else 'webkit'
with sync_playwright() as p:
  b=getattr(p,eng).launch(); ctx=b.new_context(viewport={'width':1280,'height':860}); pg=ctx.new_page(); errs=[]
  pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:m.type=='error' and errs.append(m.text))
  pg.goto('http://localhost:8097/'); pg.wait_for_selector('.prose')
  # welcome page round-trip (toggle/callout/code/table)
  rt=pg.evaluate("""async()=>{const c=await __ln.convert();const st=__ln.store;const w=st.all().find(p=>p.title.startsWith('라이트'));
    const types=d=>{const s={};const f=n=>{s[n.type]=(s[n.type]||0)+1;(n.content||[]).forEach(f)};f(d);return s};
    const out={orig:types(w.content)};
    for(const fmt of ['md','html','docx']){const e=await c.exportPage(w,fmt,st);const r=await c.importFiles([new File([e.blob],e.name)]);out[fmt]=types(r.pages[0].content);out[fmt+'_icon']=r.pages[0].icon}
    const e=await c.exportPage(w,'md',st); out.mdText=await e.blob.text(); return out}""")
  print(json.dumps({k:v for k,v in rt.items() if k!='mdText'},ensure_ascii=False)); print(rt['mdText'][:1500])
  # new page + typing with markdown shortcuts + slash menu
  pg.click('#new-page'); pg.wait_for_timeout(300)
  pg.keyboard.type('테스트 문서'); pg.keyboard.press('Enter')
  for line in ['# 큰 제목','## 중간','- 항목 하나','항목 둘']: pg.keyboard.type(line); pg.keyboard.press('Enter')
  pg.keyboard.press('Enter'); pg.keyboard.type('[] 할 일'); pg.keyboard.press('Enter'); pg.keyboard.press('Enter')
  pg.keyboard.type('> 인용'); pg.keyboard.press('Enter'); pg.keyboard.press('Enter')
  pg.keyboard.type('```js '); pg.keyboard.type('const a = 1;'); pg.keyboard.press('ArrowDown'); pg.keyboard.press('ArrowDown')
  pg.keyboard.type('/콜아웃'); pg.wait_for_selector('.slash.in'); shot_slash=pg.screenshot(path='/workspace/lite-notes/shots/slash.png'); pg.keyboard.press('Enter'); pg.keyboard.type('콜아웃 내용')
  pg.keyboard.press('Enter'); pg.keyboard.press('Enter'); pg.keyboard.type('/표'); pg.wait_for_timeout(200); pg.keyboard.press('Enter')
  pg.wait_for_timeout(900)
  doc=pg.evaluate("(()=>{const s={};const f=n=>{s[n.type]=(s[n.type]||0)+1;(n.content||[]).forEach(f)};f(__ln.editor.getJSON());return s})()")
  print('typed doc', doc)
  pg.keyboard.press('Control+z'); pg.wait_for_timeout(100)
  print('after undo', pg.evaluate("__ln.editor.getJSON().content.filter(n=>n.type==='table').length"))
  # reload persistence
  pg.wait_for_timeout(700); pg.reload(); pg.wait_for_selector('.prose'); pg.wait_for_timeout(400)
  print('persisted title', pg.evaluate("document.querySelector('.title').value"), pg.evaluate("__ln.editor.getJSON().content.map(n=>n.type).join(',')"))
  # search
  pg.keyboard.press('Control+k'); pg.wait_for_selector('.search-modal'); pg.wait_for_timeout(300); pg.keyboard.type('여권'); pg.wait_for_timeout(200)
  print('search results', pg.eval_on_selector_all('.result b','e=>e.map(x=>x.textContent)'))
  pg.screenshot(path='/workspace/lite-notes/shots/search.png'); pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
  print('opened', pg.evaluate("document.querySelector('.title').value"))
  # export sheet via UI + download
  pg.click('#export-btn'); pg.wait_for_selector('.opts'); pg.screenshot(path='/workspace/lite-notes/shots/export.png')
  with pg.expect_download() as d: pg.click('text=Word (DOCX)')
  print('download', d.value.suggested_filename)
  # drag handle exists on hover
  pg.hover('.prose p'); pg.wait_for_timeout(200); print('handle visible', pg.evaluate("getComputedStyle(document.querySelector('.drag-handle')).visibility"))
  # dark mode
  pg.click('#theme-btn'); pg.wait_for_timeout(500); pg.screenshot(path='/workspace/lite-notes/shots/dark.png')
  print('errors', errs); b.close()
