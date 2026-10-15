// Import / export engine. Everything goes through the editor schema (HTML <-> Tiptap JSON),
// so every format shares the same normalisation and the same fidelity rules.
import { generateHTML, generateJSON } from '@tiptap/core';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import JSZip from 'jszip';
import { baseExtensions } from './extensions.js';
import { newPage, uid } from './store.js';

const EXT = baseExtensions();
export const docToHTML = doc => generateHTML(doc, EXT);
export const htmlToDoc = html => generateJSON(html || '<p></p>', EXT);
const parseDOM = html => new DOMParser().parseFromString(html, 'text/html');
const EMOJI_RE = /^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic})|\p{Emoji_Modifier}|\p{Regional_Indicator})*)\s*/u;
const NOTION_ID = /\s+[0-9a-f]{32}$/i;                  // "Page Title 1a2b...(32 hex)"
const NOTION_ID_ANY = /([0-9a-f]{32})(?=\.(md|html|csv)$|$|[?#/])/i;
export const stripNotionId = s => s.replace(NOTION_ID, '').trim();
const extOf = p => (p.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
const baseName = p => p.split('/').pop();
const dirName = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const noExt = p => p.replace(/\.[a-z0-9]+$/i, '');
function joinPath(dir, rel) {
  const out = dir ? dir.split('/') : [];
  for (const s of rel.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
}
function relPath(fromDir, to) {
  const a = fromDir ? fromDir.split('/') : [], b = to.split('/');
  while (a.length && b.length > 1 && a[0] === b[0]) { a.shift(); b.shift(); }
  return [...a.map(() => '..'), ...b].map(encodeURIComponent).join('/');
}
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', heic: 'image/heic' };
const EXT_OF_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const blobToDataURL = b => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });

/* ---------- images ---------- */
export async function compressImage(src, max = 1600) {
  try {
    if (/^data:image\/(gif|svg)/.test(src)) return src;
    const img = await new Promise((ok, no) => { const i = new window.Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (s === 1 && src.length < 400_000) return src;
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    const g = c.getContext('2d');
    const png = /^data:image\/png/.test(src);
    if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(img, 0, 0, c.width, c.height);
    const out = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
    return out.length < src.length ? out : (png && out.length > 900_000 ? c.toDataURL('image/jpeg', 0.85) : src);
  } catch { return src; }
}
export async function fileToImage(file) { return compressImage(await blobToDataURL(file)); }
function dataURLtoBytes(u) { const [h, b] = u.split(','); const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return { bytes: a, mime: h.slice(5).split(';')[0] }; }

/* ---------- HTML normalisation (Notion HTML, marked output, mammoth output, pasted HTML) ---------- */
const LANG = { 'plain text': '', plaintext: '', shell: 'bash', 'c++': 'cpp', 'c#': 'csharp', 'objective-c': 'objectivec', 'f#': 'fsharp', html: 'xml', 'java/c/c++/c#': 'java', markdown: 'markdown', sh: 'bash', zsh: 'bash', js: 'javascript', ts: 'typescript', py: 'python' };
function makeTaskItem(doc, li, checked) {
  li.setAttribute('data-type', 'taskItem'); li.setAttribute('data-checked', checked ? 'true' : 'false');
}
export async function normalizeHTML(html, ctx = {}) {
  const d = parseDOM(html), B = d.body, meta = {};
  // Notion HTML export / our own HTML export: pull title, icon, cover from the header
  const art = d.querySelector('article.page, article.ln-page');
  if (art) {
    const t = art.querySelector('.page-title, .ln-title'); if (t) meta.title = t.textContent.trim();
    const ic = art.querySelector('.page-header-icon, .ln-icon');
    if (ic) { const im = ic.querySelector('img'); meta.icon = im ? '' : ic.textContent.trim(); }
    const cv = art.querySelector('img.page-cover-image, .ln-cover img'); if (cv) meta.cover = cv.getAttribute('src');
    const body = art.querySelector('.page-body, .ln-body'); B.innerHTML = body ? body.innerHTML : '';
  } else if (!d.querySelector('body > *') && d.title) meta.title = d.title;
  B.querySelectorAll('script,style,meta,link,noscript,colgroup,.ln-noexport').forEach(n => n.remove());
  if (!meta.title) { const t = d.querySelector('head > title'); if (t && t.textContent.trim()) meta.titleHint = t.textContent.trim(); }

  // Notion to-do lists
  B.querySelectorAll('ul.to-do-list').forEach(ul => {
    ul.setAttribute('data-type', 'taskList');
    ul.querySelectorAll(':scope > li').forEach(li => {
      const cb = li.querySelector(':scope > .checkbox'); const on = cb && cb.classList.contains('checkbox-on'); cb && cb.remove();
      const ind = li.querySelector(':scope > .indented');
      const p = d.createElement('p'); [...li.childNodes].filter(n => n !== ind).forEach(n => p.appendChild(n)); li.prepend(p);
      if (ind) { while (ind.firstChild) li.appendChild(ind.firstChild); ind.remove(); }
      makeTaskItem(d, li, on);
    });
  });
  // GFM task lists (marked) & generic checkbox lists
  B.querySelectorAll('li').forEach(li => {
    if (li.getAttribute('data-type') === 'taskItem') return;
    let first = li.firstElementChild, cb = null;
    if (first && first.matches('input[type=checkbox]')) cb = first;
    else if (first && first.tagName === 'P' && first.firstElementChild && first.firstElementChild.matches('input[type=checkbox]') && !first.firstChild.textContent.trim()) cb = first.firstElementChild;
    if (!cb) return;
    const ul = li.parentElement; if (ul) ul.setAttribute('data-type', 'taskList');
    const on = cb.hasAttribute('checked'); cb.remove();
    makeTaskItem(d, li, on);
  });
  // Notion toggles: <ul class="toggle"><li><details>
  B.querySelectorAll('ul.toggle').forEach(ul => { const f = d.createDocumentFragment(); ul.querySelectorAll(':scope > li').forEach(li => { while (li.firstChild) f.appendChild(li.firstChild); }); ul.replaceWith(f); });
  B.querySelectorAll('details').forEach(det => {
    if (det.querySelector(':scope > div[data-type=detailsContent]')) return;
    let sum = det.querySelector(':scope > summary'); if (!sum) { sum = d.createElement('summary'); sum.textContent = ''; det.prepend(sum); }
    const c = d.createElement('div'); c.setAttribute('data-type', 'detailsContent');
    [...det.childNodes].filter(n => n !== sum).forEach(n => c.appendChild(n));
    if (!c.textContent.trim() && !c.querySelector('img')) c.innerHTML = '<p></p>';
    det.appendChild(c);
  });
  // callouts: Notion HTML <figure class="callout">, Notion MD <aside>
  B.querySelectorAll('figure.callout, aside').forEach(el => {
    const box = d.createElement('div'); box.setAttribute('data-callout', '');
    let emoji = el.getAttribute('data-emoji') || '';
    if (el.tagName === 'FIGURE') {
      const icon = el.querySelector('.icon'); if (icon) { emoji = icon.textContent.trim() || emoji; (icon.closest('figure > div') || icon).remove(); }
      const inner = el.querySelector(':scope > div') || el; box.innerHTML = inner.innerHTML;
    } else box.innerHTML = el.innerHTML;
    if (!emoji) {
      const w = d.createTreeWalker(box, NodeFilter.SHOW_TEXT); let t;
      while ((t = w.nextNode())) { if (!t.textContent.trim()) continue; const m = t.textContent.match(EMOJI_RE); if (m) { emoji = m[1]; t.textContent = t.textContent.slice(m[0].length); } break; }
    }
    box.setAttribute('data-emoji', emoji || '💡');
    if (!box.querySelector('p,h1,h2,h3,ul,ol,pre,blockquote,table')) box.innerHTML = `<p>${box.innerHTML.trim()}</p>`;
    el.replaceWith(box);
  });
  // Notion splits each list item into its own <ol>/<ul>; merge adjacent siblings
  B.querySelectorAll('ol, ul').forEach(l => {
    let n = l.nextSibling; while (n && n.nodeType === 3 && !n.textContent.trim()) n = n.nextSibling;
    while (n && n.nodeType === 1 && n.tagName === l.tagName && (n.getAttribute('data-type') || '') === (l.getAttribute('data-type') || '') && !n.matches('.toggle')) {
      while (n.firstChild) l.appendChild(n.firstChild); const nx = n.nextSibling; n.remove(); n = nx; while (n && n.nodeType === 3 && !n.textContent.trim()) n = n.nextSibling;
    }
  });
  // Notion "indented" children & mammoth leftovers
  B.querySelectorAll('div.indented').forEach(x => x.replaceWith(...x.childNodes));
  // code language
  B.querySelectorAll('pre').forEach(pre => {
    let code = pre.querySelector('code'); if (!code) { code = d.createElement('code'); code.textContent = pre.textContent; pre.innerHTML = ''; pre.appendChild(code); }
    const m = (code.className + ' ' + pre.className).match(/language-([\w+#\/ -]+?)(?:\s|$)/i);
    let lang = m ? m[1].toLowerCase() : '';
    lang = lang in LANG ? LANG[lang] : lang.replace(/\s+/g, '');
    code.className = lang ? 'language-' + lang : ''; code.textContent = code.textContent;
  });
  // images: unwrap <a><img></a>, resolve relative sources from the import bundle
  B.querySelectorAll('a').forEach(a => { if (a.children.length === 1 && a.firstElementChild.tagName === 'IMG' && !a.textContent.trim()) a.replaceWith(a.firstElementChild); });
  for (const img of [...B.querySelectorAll('img')]) {
    let src = img.getAttribute('src') || '';
    if (ctx.resolveAsset && src && !/^(data:|https?:|blob:)/i.test(src)) { const r = await ctx.resolveAsset(src); if (r) src = r; else ctx.missing && ctx.missing.push(src); }
    if (/^data:image/.test(src)) src = await compressImage(src);
    img.setAttribute('src', src); img.removeAttribute('style'); img.removeAttribute('width'); img.removeAttribute('height');
    // lift images out of paragraphs so they become blocks
    const p = img.closest('p'); if (p && !p.textContent.trim() && p.querySelectorAll('img').length === 1) p.replaceWith(img);
  }
  B.querySelectorAll('figure').forEach(f => { const cap = f.querySelector('figcaption'); if (cap) { const p = d.createElement('p'); p.innerHTML = cap.innerHTML; cap.replaceWith(p); } f.replaceWith(...f.childNodes); });
  // links
  if (ctx.resolveLink) B.querySelectorAll('a[href]').forEach(a => { const r = ctx.resolveLink(a.getAttribute('href')); if (r) a.setAttribute('href', r); });
  // tables: first row with th => header; strip Notion classes/ids
  B.querySelectorAll('table').forEach(t => { t.querySelectorAll('thead tr').forEach(tr => t.querySelector('tbody') ? t.querySelector('tbody').prepend(tr) : 0); });
  B.querySelectorAll('[class]').forEach(e => { if (!/language-/.test(e.className)) e.removeAttribute('class'); });
  // underline from mammoth/Word comes as <u>; highlight-free
  return { html: B.innerHTML, ...meta };
}

/* ---------- Markdown ---------- */
function splitFrontMatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/); const fm = {};
  if (!m) return { md, fm };
  m[1].split(/\r?\n/).forEach(l => { const k = l.match(/^(\w+):\s*(.*)$/); if (k) fm[k[1]] = k[2].replace(/^["']|["']$/g, ''); });
  return { md: md.slice(m[0].length), fm };
}
export function mdToHTML(md) {
  // Notion MD toggles are list items with indented content; keep them as lists (closest lossless mapping)
  return marked.parse(md, { gfm: true, breaks: false });
}
function preprocessForMD(html) {
  const d = parseDOM(html), B = d.body;
  B.querySelectorAll('colgroup').forEach(c => c.remove()); B.querySelectorAll('table').forEach(t => t.removeAttribute('style'));
  // tight lists: <li><p>x</p></li> -> <li>x</li>
  B.querySelectorAll('li').forEach(li => { const ps = [...li.children].filter(c => c.tagName === 'P'); if (ps.length === 1 && li.firstElementChild === ps[0]) ps[0].replaceWith(...ps[0].childNodes); const dv = li.getAttribute('data-type') === 'taskItem' && li.querySelector(':scope > div'); if (dv) { const p2 = [...dv.children].filter(c => c.tagName === 'P'); if (p2.length === 1 && dv.firstElementChild === p2[0]) p2[0].replaceWith(...p2[0].childNodes); } });
  B.querySelectorAll('td p, th p').forEach(p => { const br = d.createElement('br'); p.after(br); p.replaceWith(...p.childNodes); });
  B.querySelectorAll('td > br:last-child, th > br:last-child').forEach(b => b.remove());
  B.querySelectorAll('table').forEach(t => { const tr = t.querySelector('tr'); if (tr && [...tr.children].some(c => c.tagName === 'TD')) [...tr.children].forEach(td => { const th = d.createElement('th'); th.innerHTML = td.innerHTML; td.replaceWith(th); }); });
  return B.innerHTML;
}
let _td;
function turndown() {
  if (_td) return _td;
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', hr: '---', emDelimiter: '*', strongDelimiter: '**' });
  td.use(gfm);
  td.addRule('taskItem', {
    filter: n => n.nodeName === 'LI' && n.getAttribute('data-type') === 'taskItem',
    replacement: (content, n) => {
      content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n  ').replace(/\n  $/, '\n');
      return '- [' + (n.getAttribute('data-checked') === 'true' ? 'x' : ' ') + '] ' + content + (n.nextSibling && !/\n$/.test(content) ? '\n' : '');
    },
  });
  td.addRule('taskLabel', { filter: n => n.nodeName === 'LABEL' && n.parentNode && n.parentNode.getAttribute && n.parentNode.getAttribute('data-type') === 'taskItem', replacement: () => '' });
  td.addRule('details', {
    filter: 'details',
    replacement: (_, n) => {
      const s = n.querySelector(':scope > summary'); const c = n.querySelector(':scope > div[data-type=detailsContent]');
      return `\n\n<details${n.hasAttribute('open') ? ' open' : ''}>\n<summary>${s ? s.innerHTML.replace(/<\/?p>/g, '') : ''}</summary>\n\n${c ? td.turndown(c.innerHTML) : ''}\n\n</details>\n\n`;
    },
  });
  td.addRule('callout', {
    filter: n => n.nodeName === 'DIV' && n.hasAttribute('data-callout'),
    replacement: (_, n) => `\n\n<aside>\n\n${n.getAttribute('data-emoji') || '💡'} ${td.turndown(n.innerHTML)}\n\n</aside>\n\n`,
  });
  td.addRule('listItem', {
    filter: n => n.nodeName === 'LI' && n.getAttribute('data-type') !== 'taskItem',
    replacement: (content, node, options) => {
      content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n   ');
      const parent = node.parentNode; let prefix = '- ';
      if (parent.nodeName === 'OL') { const start = parent.getAttribute('start'); const i = [...parent.children].indexOf(node); prefix = (start ? Number(start) + i : i + 1) + '. '; }
      else content = content.replace(/\n {3}/g, '\n  ');
      return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
    },
  });
  td.addRule('cellBreak', { filter: n => n.nodeName === 'BR' && n.closest && n.closest('td,th'), replacement: () => '<br>' });
  td.addRule('underline', { filter: ['u'], replacement: c => `<u>${c}</u>` });
  td.addRule('strike', { filter: ['s', 'del', 'strike'], replacement: c => `~~${c}~~` });
  return (_td = td);
}
export const htmlToMD = html => turndown().turndown(preprocessForMD(html)).replace(/\n{3,}/g, '\n\n').trim() + '\n';

/* ---------- export ---------- */
const sanitize = s => (s || '제목 없음').replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '제목 없음';
export const titleOf = p => p.title || '제목 없음';

// path plan for a set of pages, Notion-style: "Parent.md" + "Parent/Child.md"
function planPaths(store, roots, ext) {
  const map = new Map();
  const walk = (pages, dir) => {
    const used = new Set();
    for (const p of pages) {
      let n = sanitize(p.title), k = n, i = 2; while (used.has(k.toLowerCase())) k = `${n} (${i++})`; used.add(k.toLowerCase());
      const path = (dir ? dir + '/' : '') + k + '.' + ext; map.set(p.id, path);
      walk(store.children(p.id), noExt(path));
    }
  };
  walk(roots, ''); return map;
}
async function pageBodyHTML(page, { images, paths, fromPath, inlineImages, store }) {
  const d = parseDOM(docToHTML(page.content));
  for (const img of d.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (!inlineImages && src.startsWith('data:')) {
      let name = images.byData.get(src);
      if (!name) { const { mime } = dataURLtoBytes(src.slice(0, 64) + ',') || {}; const ext = EXT_OF_MIME[(src.match(/^data:([^;]+)/) || [])[1]] || 'png'; name = `images/${String(images.byData.size + 1).padStart(3, '0')}.${ext}`; images.byData.set(src, name); }
      img.setAttribute('src', relPath(dirName(fromPath), name).replace(/%2F/g, '/'));
    }
  }
  d.querySelectorAll('a[href^="#/p/"]').forEach(a => {
    const id = a.getAttribute('href').slice(4);
    if (paths && paths.has(id)) a.setAttribute('href', relPath(dirName(fromPath), paths.get(id)));
    else if (store && store.get(id)) a.setAttribute('href', encodeURIComponent(sanitize(store.get(id).title)) + '.' + (fromPath || '.md').split('.').pop());
    else a.replaceWith(...a.childNodes);
  });
  return d.body.innerHTML;
}
function frontMatter(p) { const l = []; if (p.icon) l.push(`icon: ${p.icon}`); if (p.cover && !p.cover.startsWith('data:')) l.push(`cover: ${p.cover}`); return l.length ? `---\n${l.join('\n')}\n---\n\n` : ''; }
async function pageToMD(page, o) { return frontMatter(page) + `# ${titleOf(page)}\n\n` + htmlToMD(await pageBodyHTML(page, o)); }

export const EXPORT_CSS = `body{margin:0;background:#FAF7F2;color:#2B2621;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",sans-serif}
.ln-page{max-width:760px;margin:0 auto;padding:48px 24px 96px}.ln-cover{height:200px;border-radius:20px;margin-bottom:-36px;background-size:cover;background-position:center}.ln-cover img{width:100%;height:100%;object-fit:cover;border-radius:20px}
.ln-icon{font-size:56px;line-height:1;position:relative}.ln-title{font-size:36px;letter-spacing:-.02em;margin:12px 0 24px}
h1{font-size:28px}h2{font-size:22px}h3{font-size:18px}img{max-width:100%;border-radius:12px}a{color:#7A5FD0}
blockquote{margin:12px 0;padding:4px 16px;border-left:4px solid #D9CFF3;color:#5b524a}pre{background:#F3EDE3;padding:16px;border-radius:12px;overflow:auto;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
code{background:#F3EDE3;border-radius:4px;padding:2px 4px;font-family:ui-monospace,Menlo,monospace;font-size:.9em}pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #E8E0D4;padding:8px 12px;text-align:left;vertical-align:top}th{background:#F3EDE3}td p,th p{margin:0}
ul[data-type=taskList]{list-style:none;padding-left:4px}ul[data-type=taskList] li{display:flex;gap:8px}ul[data-type=taskList] li>label{flex:none}ul[data-type=taskList] li[data-checked=true]>div{text-decoration:line-through;color:#8A8077}
.callout{display:flex;gap:12px;background:#FBF3D5;border-radius:12px;padding:12px 16px;margin:12px 0}.callout::before{content:attr(data-emoji);font-size:20px}.callout>*:first-child{margin-top:0}
details{background:#fff;border-radius:12px;padding:8px 16px;margin:8px 0}summary{cursor:pointer;font-weight:600}hr{border:0;border-top:1px solid #E8E0D4;margin:24px 0}
@media print{body{background:#fff}.ln-page{padding:0}}`;
import { COVERS } from './covers.js';
export { COVERS };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function htmlDoc(page, body, coverSrc) {
  const cover = page.cover ? (COVERS[page.cover] ? `<div class="ln-cover" style="background:${COVERS[page.cover]}"></div>` : `<div class="ln-cover"><img class="page-cover-image" src="${esc(coverSrc || page.cover)}" alt=""></div>`) : '';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titleOf(page))}</title><style>${EXPORT_CSS}</style></head><body><article class="ln-page">${cover}<header>${page.icon ? `<div class="ln-icon">${esc(page.icon)}</div>` : ''}<h1 class="ln-title">${esc(titleOf(page))}</h1></header><div class="ln-body">${body}</div></article></body></html>`;
}

export async function exportPage(page, fmt, store) {
  const name = sanitize(page.title);
  if (fmt === 'md') {
    const images = { byData: new Map() };
    const md = await pageToMD(page, { images, fromPath: name + '.md', store });
    if (!images.byData.size) return { name: name + '.md', blob: new Blob([md], { type: 'text/markdown' }) };
    const z = new JSZip(); z.file(name + '.md', md);
    images.byData.forEach((p, data) => z.file(p, dataURLtoBytes(data).bytes));
    return { name: name + '.zip', blob: await z.generateAsync({ type: 'blob' }) };
  }
  if (fmt === 'html') return { name: name + '.html', blob: new Blob([htmlDoc(page, await pageBodyHTML(page, { inlineImages: true, fromPath: name + '.html', store }))], { type: 'text/html' }) };
  if (fmt === 'docx') { const { pageToDocx } = await import('./docx-export.js'); return { name: name + '.docx', blob: await pageToDocx(page, store) }; }
  throw new Error('unknown format');
}

export async function exportWorkspace(store, fmt, rootId = null) {
  const z = new JSZip();
  const roots = rootId ? [store.get(rootId)] : store.children(null);
  if (fmt === 'json') {
    const pages = rootId ? [store.get(rootId), ...store.descendants(rootId)] : store.all();
    return { name: `lite-notes-backup-${new Date().toISOString().slice(0, 10)}.json`, blob: new Blob([JSON.stringify({ app: 'lite-notes', version: 1, exportedAt: new Date().toISOString(), pages }, null, 1)], { type: 'application/json' }) };
  }
  const ext = fmt === 'html' ? 'html' : 'md';
  const paths = planPaths(store, roots, ext), images = { byData: new Map() };
  for (const [id, path] of paths) {
    const p = store.get(id);
    if (ext === 'md') z.file(path, await pageToMD(p, { images, paths, fromPath: path }));
    else {
      let cover = ''; if (p.cover && p.cover.startsWith('data:')) { const dz = parseDOM(`<img src="${p.cover}">`); cover = p.cover; }
      z.file(path, htmlDoc(p, await pageBodyHTML(p, { images, paths, fromPath: path }), cover));
    }
  }
  images.byData.forEach((p, data) => z.file(p, dataURLtoBytes(data).bytes));
  const base = rootId ? sanitize(store.get(rootId).title) : 'lite-notes';
  return { name: `${base}-${ext}.zip`, blob: await z.generateAsync({ type: 'blob', compression: 'DEFLATE' }) };
}

/* ---------- import ---------- */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const csvToHTML = (rows, linkFor) => !rows.length ? '<p></p>' : `<table><tbody>${rows.map((r, i) => `<tr>${r.map((c, j) => { const tag = i ? 'td' : 'th'; const href = i && j === 0 && linkFor ? linkFor(c) : null; const v = esc(c).replace(/\n/g, '<br>'); return `<${tag}><p>${href ? `<a href="${href}">${v}</a>` : v}</p></${tag}>`; }).join('')}</tr>`).join('')}</tbody></table>`;

async function docxToHTML(buf) {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default;
  const r = await mammoth.convertToHtml({ arrayBuffer: buf }, {
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Code'] => pre:separator('\\n')", "p[style-name='Quote'] => blockquote > p:fresh", "p[style-name='Intense Quote'] => blockquote > p:fresh", "p[style-name='Callout'] => aside > p:fresh", "p[style-name='Toggle'] => details > summary", 'u => u', 'strike => s', "r[style-name='Code Char'] => code"],
    convertImage: mammoth.images.imgElement(img => img.read('base64').then(b => ({ src: `data:${img.contentType};base64,${b}` }))),
  });
  // our own DOCX export writes to-dos as "☐ / ☑" paragraphs -> rebuild task lists
  const d = parseDOM(r.value);
  [...d.body.querySelectorAll('p')].forEach(p => {
    const m = p.textContent.match(/^\s*([☐☑✅⬜])\s?/); if (!m) return;
    const first = d.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode(); if (first) first.textContent = first.textContent.replace(/^\s*[☐☑✅⬜]\s?/, '');
    const li = d.createElement('li'); li.setAttribute('data-type', 'taskItem'); li.setAttribute('data-checked', /[☑✅]/.test(m[1]) ? 'true' : 'false');
    const np = d.createElement('p'); np.innerHTML = p.innerHTML; li.appendChild(np);
    const prev = p.previousElementSibling;
    if (prev && prev.getAttribute('data-type') === 'taskList') { prev.appendChild(li); p.remove(); }
    else { const ul = d.createElement('ul'); ul.setAttribute('data-type', 'taskList'); ul.appendChild(li); p.replaceWith(ul); }
  });
  d.body.querySelectorAll('p').forEach(p => { if (/^\s*(· · ·|\* \* \*|---|⸻)\s*$/.test(p.textContent)) p.replaceWith(d.createElement('hr')); });
  d.body.querySelectorAll('summary, th').forEach(x => { x.querySelectorAll('strong').forEach(st => st.replaceWith(...st.childNodes)); const w = d.createTreeWalker(x, NodeFilter.SHOW_TEXT).nextNode(); if (w) w.textContent = w.textContent.replace(/^▸\s*/, ''); });
  // consecutive <pre> blocks from Code-styled paragraphs
  d.body.querySelectorAll('pre').forEach(pre => { let n = pre.nextElementSibling; while (n && n.tagName === 'PRE') { pre.textContent += '\n' + n.textContent; const x = n.nextElementSibling; n.remove(); n = x; } });
  // consecutive blockquotes
  d.body.querySelectorAll('blockquote').forEach(b => { let n = b.nextElementSibling; while (n && n.tagName === 'BLOCKQUOTE') { b.append(...n.childNodes); const x = n.nextElementSibling; n.remove(); n = x; } });
  // Word "Title" style paragraphs come out as <p>; first h1 is used as page title below
  return { html: d.body.innerHTML, warnings: r.messages.length };
}

function finishPage(p, html) {
  p.content = htmlToDoc(html);
  p.text = parseDOM(html).body.textContent.replace(/\s+/g, ' ').trim().slice(0, 20000);
  return p;
}
function takeLeadingTitle(html, title) {
  const d = parseDOM(html); const f = d.body.firstElementChild;
  if (f && f.tagName === 'H1' && (!title || stripNotionId(f.textContent.trim()) === title || true)) { const t = f.textContent.trim(); f.remove(); return { html: d.body.innerHTML, title: t }; }
  return { html, title: null };
}
// Notion MD: property block right under the title ("Created: …", "Tags: …") -> keep as a small table
function notionProps(html) {
  const d = parseDOM(html); const f = d.body.firstElementChild;
  if (f && f.tagName === 'P' && /^[^\n:]{1,40}: /.test(f.textContent) && f.textContent.split('\n').every(l => /^[^:]{1,40}: /.test(l))) {
    const rows = f.textContent.split('\n').map(l => { const i = l.indexOf(': '); return [l.slice(0, i), l.slice(i + 2)]; });
    f.outerHTML = `<table><tbody>${rows.map(([k, v]) => `<tr><th><p>${esc(k)}</p></th><td><p>${esc(v)}</p></td></tr>`).join('')}</tbody></table>`;
  }
  return d.body.innerHTML;
}

async function fileText(f) { return typeof f === 'string' ? f : await f.text(); }

// Single non-zip file -> one page
async function importSingle(file) {
  const ext = extOf(file.name), base = stripNotionId(noExt(file.name)); const p = newPage({ title: base });
  let html = '';
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
    let { md, fm } = splitFrontMatter(await file.text()); if (fm.icon) p.icon = fm.icon; if (fm.cover) p.cover = fm.cover; if (fm.title) p.title = fm.title;
    html = ext === 'txt' ? md.split(/\n{2,}/).map(b => `<p>${esc(b).replace(/\n/g, '<br>')}</p>`).join('') : mdToHTML(md);
    const t = takeLeadingTitle(html); if (t.title) { p.title = fm.title || stripNotionId(t.title); html = t.html; }
    html = (await normalizeHTML(notionProps(html))).html;
  } else if (ext === 'html' || ext === 'htm') {
    const n = await normalizeHTML(await file.text()); html = n.html;
    if (n.title) p.title = n.title; else { const t = takeLeadingTitle(html); if (t.title) { p.title = t.title; html = t.html; } else if (n.titleHint) p.title = n.titleHint; }
    if (n.icon) p.icon = n.icon; if (n.cover && n.cover.startsWith('data:')) p.cover = n.cover;
  } else if (ext === 'docx') {
    const r = await docxToHTML(await file.arrayBuffer()); html = r.html;
    const t = takeLeadingTitle(html); if (t.title) { const m = t.title.match(EMOJI_RE); if (m) { p.icon = m[1]; p.title = t.title.slice(m[0].length); } else p.title = t.title; html = t.html; }
    html = (await normalizeHTML(html.replace(/<summary>▸\s*/g, '<summary>'))).html;
  } else if (ext === 'csv') {
    html = csvToHTML(parseCSV(await file.text()));
  } else throw new Error(`지원하지 않는 형식: .${ext}`);
  return [finishPage(p, html)];
}

// Zip: Notion export (Markdown & CSV or HTML), our own MD/HTML export, or any folder of md/html/docx
async function importZip(buf, report) {
  let zip = await JSZip.loadAsync(buf);
  // Notion wraps big exports as zip-in-zip ("Export-xxxx-Part-1.zip")
  for (let depth = 0; depth < 2; depth++) {
    const files = Object.values(zip.files).filter(f => !f.dir && !/__MACOSX|\.DS_Store/.test(f.name));
    const inner = files.filter(f => extOf(f.name) === 'zip');
    if (inner.length && files.every(f => extOf(f.name) === 'zip')) {
      const merged = new JSZip();
      for (const iz of inner) { const z2 = await JSZip.loadAsync(await iz.async('arraybuffer')); for (const f of Object.values(z2.files)) if (!f.dir) merged.file(f.name, await f.async('arraybuffer')); }
      zip = merged;
    } else break;
  }
  const entries = new Map(); Object.values(zip.files).forEach(f => { if (!f.dir && !/__MACOSX|(^|\/)\.DS_Store$/.test(f.name)) entries.set(f.name.normalize('NFC'), f); });
  const docExt = new Set(['md', 'markdown', 'html', 'htm', 'csv', 'docx', 'txt']);
  let docs = [...entries.keys()].filter(k => docExt.has(extOf(k)));
  // Notion: "DB abc.csv" + "DB abc_all.csv" -> keep the _all one (it has every property)
  docs = docs.filter(k => !(extOf(k) === 'csv' && !/_all\.csv$/.test(k) && entries.has(noExt(k) + '_all.csv')));
  const keyOf = k => noExt(k).replace(/_all$/, '');
  // a .md and .html of the same page (rare) -> prefer md
  const byKey = new Map(); docs.forEach(k => { const key = keyOf(k); if (!byKey.has(key) || extOf(k) === 'md') byKey.set(key, k); });
  // common wrapper folder ("Export-1234/") that is not a page itself
  let keys = [...byKey.keys()];
  const dirs = new Set(); keys.forEach(k => { let d = dirName(k); while (d) { dirs.add(d); d = dirName(d); } });
  const pages = new Map(), hexToKey = new Map();
  const mk = (key, file) => { const raw = baseName(key); const p = newPage({ title: stripNotionId(raw) || '제목 없음' }); const hex = raw.match(/([0-9a-f]{32})$/i); if (hex) hexToKey.set(hex[1].toLowerCase(), key); pages.set(key, { p, file }); };
  keys.forEach(k => mk(k, byKey.get(k)));
  // folders that hold pages but have no page file of their own become folder pages, except a single shared root
  const topDirs = new Set(keys.map(k => k.split('/')[0]).filter((x, i, a) => true));
  const wrapper = (topDirs.size === 1 && !byKey.has([...topDirs][0]) && keys.every(k => k.includes('/'))) ? [...topDirs][0] : null;
  [...dirs].sort().forEach(d => { if (d === wrapper || pages.has(d)) return; if (wrapper && !d.startsWith(wrapper + '/')) return; mk(d, null); pages.get(d).p.icon = '📁'; });
  const parentKey = key => { let d = dirName(key); while (d) { if (pages.has(d)) return d; d = dirName(d); } return null; };
  let order = Date.now();
  // resolvers
  const findEntry = path => { const n = path.normalize('NFC'); if (entries.has(n)) return n; const low = n.toLowerCase(); for (const k of entries.keys()) if (k.toLowerCase() === low) return k; return null; };
  const linkResolverFor = fileKey => href => {
    if (!href || /^(mailto:|tel:|#)/i.test(href)) return null;
    if (/^https?:\/\/(www\.)?notion\.(so|site)\//i.test(href)) { const m = href.match(/([0-9a-f]{32})(?:[?#]|$)/i); const k = m && hexToKey.get(m[1].toLowerCase()); return k ? `#/p/${pages.get(k).p.id}` : null; }
    if (/^[a-z]+:/i.test(href)) return null;
    const path = joinPath(dirName(fileKey), safeDecode(href.split('#')[0].split('?')[0]));
    const k = keyOf(path); if (pages.has(k)) return `#/p/${pages.get(k).p.id}`;
    const hex = path.match(NOTION_ID_ANY); if (hex && hexToKey.has(hex[1].toLowerCase())) return `#/p/${pages.get(hexToKey.get(hex[1].toLowerCase())).p.id}`;
    return null;
  };
  const assetResolverFor = fileKey => async src => {
    const rel = safeDecode(src.split('?')[0]);
    const e = findEntry(joinPath(dirName(fileKey), rel)) || findEntry(joinPath(noExt(fileKey), rel)) || findEntry(joinPath(noExt(fileKey), baseName(rel))) || findEntry(rel);
    if (!e) return null; const m = MIME[extOf(e)]; if (!m) return null;
    return `data:${m};base64,` + await entries.get(e).async('base64');
  };
  const missing = [];
  for (const [key, { p, file }] of pages) {
    const pk = parentKey(key); p.parentId = pk ? pages.get(pk).p.id : null; p.order = order++;
    let html = '<p></p>';
    if (file) {
      const ctx = { resolveAsset: assetResolverFor(file), resolveLink: linkResolverFor(file), missing };
      const ext = extOf(file), ent = entries.get(file);
      if (ext === 'md' || ext === 'markdown') {
        const { md, fm } = splitFrontMatter(await ent.async('string')); if (fm.icon) p.icon = fm.icon;
        if (fm.cover && COVERS[fm.cover]) p.cover = fm.cover;
        let h = mdToHTML(md); const t = takeLeadingTitle(h); if (t.title) { p.title = stripNotionId(t.title) || p.title; h = t.html; }
        html = (await normalizeHTML(notionProps(h), ctx)).html;
      } else if (ext === 'html' || ext === 'htm') {
        const n = await normalizeHTML(await ent.async('string'), ctx); html = n.html;
        if (n.title) p.title = n.title; if (n.icon) p.icon = n.icon;
        if (n.cover) { const r = /^data:/.test(n.cover) ? n.cover : await ctx.resolveAsset(n.cover); if (r) p.cover = await compressImage(r); }
      } else if (ext === 'csv') {
        const rows = parseCSV(await ent.async('string'));
        const rowDir = key; // rows live in "DB abc/"
        html = csvToHTML(rows, name => { for (const [k2, v] of pages) if (dirName(k2) === rowDir && v.p.title === name.trim()) return `#/p/${v.p.id}`; return null; });
        p.icon = p.icon || '🗂️';
      } else if (ext === 'docx') {
        const r = await docxToHTML(await ent.async('arraybuffer')); html = (await normalizeHTML(r.html, ctx)).html;
      } else if (ext === 'txt') html = (await ent.async('string')).split(/\n{2,}/).map(b => `<p>${esc(b)}</p>`).join('');
    } else html = '<p></p>';
    finishPage(p, html);
  }
  // keep folder order from the parent page: order children by where their link appears in the parent
  const list = [...pages.values()].map(v => v.p);
  const byId = new Map(list.map(p => [p.id, p]));
  list.forEach(par => { const ids = [...JSON.stringify(par.content).matchAll(/#\/p\/([a-z0-9]+)/g)].map(m => m[1]); ids.forEach((id, i) => { const c = byId.get(id); if (c && c.parentId === par.id) c.order = i; }); });
  report.missing = missing; report.links = list.reduce((n, p) => n + (JSON.stringify(p.content).match(/#\/p\//g) || []).length, 0);
  report.images = list.reduce((n, p) => n + (JSON.stringify(p.content).match(/"type":"image"/g) || []).length, 0);
  return list;
}

export async function importFiles(files) {
  const out = [], report = { pages: 0, missing: [], images: 0, links: 0, errors: [] };
  for (const f of files) {
    try {
      const ext = extOf(f.name);
      if (ext === 'zip') out.push(...await importZip(await f.arrayBuffer(), report));
      else if (ext === 'json') {
        const j = JSON.parse(await f.text()); if (!Array.isArray(j.pages)) throw new Error('백업 파일이 아니에요');
        const idMap = new Map(j.pages.map(p => [p.id, uid()]));
        j.pages.forEach(p => { const s = JSON.stringify(p.content).replace(/#\/p\/([a-z0-9]+)/g, (m, id) => idMap.has(id) ? '#/p/' + idMap.get(id) : m); out.push({ ...p, id: idMap.get(p.id), parentId: p.parentId ? idMap.get(p.parentId) || null : null, content: JSON.parse(s) }); });
      } else out.push(...await importSingle(f));
    } catch (e) { console.error(e); report.errors.push(`${f.name}: ${e.message}`); }
  }
  report.pages = out.length;
  if (!report.images) report.images = out.reduce((n, p) => n + (JSON.stringify(p.content).match(/"type":"image"/g) || []).length, 0);
  return { pages: out, report };
}

// paste/drag of rich HTML into the editor
export async function cleanPastedHTML(html) { return (await normalizeHTML(html)).html; }
