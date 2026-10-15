import sys
from playwright.sync_api import sync_playwright
url=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8097/'
S='/workspace/lite-notes/shots/'
with sync_playwright() as p:
  b=p.webkit.launch(); errs=[]
  c=b.new_context(viewport={'width':1360,'height':860}); pg=c.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:m.type=='error' and errs.append(m.text))
  pg.goto(url); pg.wait_for_selector('.prose'); pg.wait_for_timeout(1200); pg.screenshot(path=S+'desktop.png')
  pg.click('#export-btn'); pg.wait_for_timeout(700); pg.screenshot(path=S+'desktop-export.png'); pg.keyboard.press('Escape')
  pg.click('#import-btn'); pg.wait_for_timeout(700); pg.screenshot(path=S+'desktop-import.png'); pg.keyboard.press('Escape')
  c.close()
  c=b.new_context(viewport={'width':390,'height':844},device_scale_factor=3,has_touch=True); pg=c.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
  pg.goto(url); pg.wait_for_selector('.prose'); pg.wait_for_timeout(1200); pg.screenshot(path=S+'mobile.png')
  pg.click('#menu-btn'); pg.wait_for_timeout(700); pg.screenshot(path=S+'mobile-sidebar.png'); pg.mouse.click(375,500); pg.wait_for_timeout(500)
  pg.click('.prose p'); pg.wait_for_timeout(500); pg.screenshot(path=S+'mobile-editing.png')
  pg.click('#export-btn'); pg.wait_for_timeout(800); pg.screenshot(path=S+'mobile-export.png')
  print('errors',errs); b.close()
