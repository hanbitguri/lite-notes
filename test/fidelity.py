import json, sys
from playwright.sync_api import sync_playwright
URL='http://localhost:8097/'
JS=r"""
async () => {
  const c = await __ln.convert(); const store = __ln.store;
  const sum = doc => { const s = { types:{}, checked:0, unchecked:0, internal:0, external:0, images:0, langs:[], cells:0, headings:[], text:'' };
    const walk = n => { s.types[n.type]=(s.types[n.type]||0)+1;
      if(n.type==='taskItem') n.attrs.checked?s.checked++:s.unchecked++;
      if(n.type==='image'){ s.images++; if(!/^data:image/.test(n.attrs.src)) s.badImg=(s.badImg||0)+1; }
      if(n.type==='codeBlock') s.langs.push(n.attrs.language);
      if(n.type==='tableCell'||n.type==='tableHeader') s.cells++;
      if(n.type==='heading') s.headings.push(n.attrs.level+':'+(n.content||[]).map(t=>t.text).join(''));
      if(n.type==='text'){ s.text+=n.text+' '; (n.marks||[]).forEach(m=>{ if(m.type==='link') (m.attrs.href.startsWith('#/p/')?s.internal++:s.external++); s.marks=s.marks||{}; s.marks[m.type]=(s.marks[m.type]||0)+1; }); }
      (n.content||[]).forEach(walk); };
    walk(doc); s.text=s.text.slice(0,160); return s; };
  const fileOf = async (url, name) => new File([await (await fetch(url)).blob()], name);
  const tree = pages => { const by=new Map(pages.map(p=>[p.id,p])); const path=p=>{const a=[];let x=p;while(x){a.unshift(x.title);x=by.get(x.parentId);}return a.join(' / ');}; return pages.map(p=>path(p)).sort(); };
  const brokenLinks = pages => { const ids=new Set(pages.map(p=>p.id)); let b=0; pages.forEach(p=>[...JSON.stringify(p.content).matchAll(/#\/p\/([a-z0-9]+)/g)].forEach(m=>{ if(!ids.has(m[1])) b++; })); return b; };
  const out = {};
  const report = (label, pages, rep) => { out[label] = { tree: tree(pages), report: rep && { images: rep.images, links: rep.links, missing: rep.missing, errors: rep.errors }, brokenInternalLinks: brokenLinks(pages), pages: Object.fromEntries(pages.map(p=>[p.title,{icon:p.icon, cover: p.cover ? p.cover.slice(0,22) : '', ...sum(p.content)}])) }; };
  // 1. Notion MD zip
  let r = await c.importFiles([await fileOf('/test/fixtures/notion-md.zip','Export-7f3e.zip')]); report('notionMD', r.pages, r.report);
  // 2. Notion HTML zip-in-zip
  let r2 = await c.importFiles([await fileOf('/test/fixtures/notion-html.zip','Export-html.zip')]); report('notionHTML', r2.pages, r2.report);
  // 3. plain md
  let r3 = await c.importFiles([await fileOf('/test/fixtures/plain.md','plain.md')]); report('plainMD', r3.pages, r3.report);
  // Round trips: put Notion MD import in the store under a fresh root, export, re-import
  const roots = r.pages.filter(p=>!p.parentId); await store.saveMany(r.pages);
  const travel = r.pages.find(p=>p.title==='Travel Plans');
  const blobToFile = (res) => new File([res.blob], res.name);
  // workspace md zip of the Travel Plans subtree
  let e1 = await c.exportWorkspace(store, 'md', travel.id); let rt1 = await c.importFiles([blobToFile(e1)]); report('rt_md_zip', rt1.pages, rt1.report);
  // html zip
  let e2 = await c.exportWorkspace(store, 'html', travel.id); let rt2 = await c.importFiles([blobToFile(e2)]); report('rt_html_zip', rt2.pages, rt2.report);
  // single page exports
  let e3 = await c.exportPage(travel, 'md', store); let rt3 = await c.importFiles([blobToFile(e3)]); report('rt_page_md('+e3.name+')', rt3.pages, rt3.report);
  let e4 = await c.exportPage(travel, 'html', store); let rt4 = await c.importFiles([blobToFile(e4)]); report('rt_page_html', rt4.pages, rt4.report);
  let e5 = await c.exportPage(travel, 'docx', store); let rt5 = await c.importFiles([blobToFile(e5)]); report('rt_page_docx', rt5.pages, rt5.report);
  let e6 = await c.exportWorkspace(store, 'json', travel.id); let rt6 = await c.importFiles([blobToFile(e6)]); report('rt_json', rt6.pages, rt6.report);
  out.sizes = { md: e1.blob.size, html: e2.blob.size, docx: e5.blob.size, names: [e1.name, e2.name, e3.name, e4.name, e5.name, e6.name] };
  // sample markdown text for eyeballing
  const z = await (await import('/dist/main.js').catch(()=>null), null);
  out.mdSample = await (async()=>{ const JSZip = null; return null; })();
  out.travelMD = (await (await c.exportPage({...travel, content: travel.content}, 'html', store)).blob.text()).length;
  return out;
}
"""
with sync_playwright() as p:
  eng=sys.argv[1] if len(sys.argv)>1 else 'chromium'
  b=getattr(p,eng).launch(); pg=b.new_page(); errs=[]
  pg.on('pageerror',lambda e:errs.append(str(e)))
  pg.goto(URL); pg.wait_for_selector('.prose')
  res=pg.evaluate(JS)
  json.dump(res,open(f'fidelity-{eng}.json','w'),ensure_ascii=False,indent=1)
  print('errors',errs); b.close()
