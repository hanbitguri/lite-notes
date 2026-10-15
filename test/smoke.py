import sys
from playwright.sync_api import sync_playwright
url=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8097/'
with sync_playwright() as p:
  for name in ['webkit','chromium']:
    b=getattr(p,name).launch(); errs=[]
    for vp,shot in [({'width':390,'height':844},'mobile'),({'width':1360,'height':860},'desktop')]:
      ctx=b.new_context(viewport=vp,device_scale_factor=2 if vp['width']<500 else 1, has_touch=vp['width']<500, is_mobile=False)
      pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:m.type=='error' and errs.append(m.text))
      pg.goto(url); pg.wait_for_selector('.prose'); pg.wait_for_timeout(900)
      pg.screenshot(path=f'/workspace/lite-notes/shots/{name}-{shot}.png')
      ctx.close()
    print(name,'errors:',errs); b.close()
