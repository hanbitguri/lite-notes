import { Editor, Extension } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import DragHandle from '@tiptap/extension-drag-handle';
import Suggestion from '@tiptap/suggestion';
import { baseExtensions } from './extensions.js';
import { Store, IndexedDBAdapter, newPage } from './store.js';
import { seedPages } from './seed.js';
import { COVERS } from './covers.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else if (v != null && v !== false) e.setAttribute(k, v); } kids.flat().forEach(k => k != null && e.append(k)); return e; };
const isMac = /Mac|iPhone|iPad/.test(navigator.platform), MOD = isMac ? '⌘' : 'Ctrl';
const mobile = () => matchMedia('(max-width: 899px)').matches;
const convert = () => import('./convert.js');
const store = new Store(new IndexedDBAdapter());
let editor = null, current = null, saveTimer = null;
window.__ln = { store, get editor() { return editor; }, convert }; // handy for tests/devtools

/* ---------- toast ---------- */
function toast(msg, action) {
  const t = h('div', { class: 'toast' }, h('span', {}, msg)); if (action) t.append(h('button', { onclick: () => { action.run(); t.remove(); } }, action.label));
  $('#toasts').append(t); requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, action ? 6000 : 2600);
}
function download({ name, blob }) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }

/* ---------- popovers / sheets ---------- */
let openPop = null;
function closePop() { if (!openPop) return; const p = openPop; openPop = null; p.classList.remove('in'); setTimeout(() => p.remove(), 260); $('#scrim').classList.remove('on'); }
function popover(content, anchor, { sheet } = {}) {
  closePop();
  const p = h('div', { class: 'pop' + (sheet || mobile() ? ' as-sheet' : '') }, content); document.body.append(p);
  if (!p.classList.contains('as-sheet') && anchor) {
    const r = anchor.getBoundingClientRect(); const w = p.offsetWidth, ph = p.offsetHeight;
    let x = Math.min(innerWidth - w - 8, Math.max(8, r.left)), y = r.bottom + 8; if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 8);
    p.style.left = x + 'px'; p.style.top = y + 'px';
  } else $('#scrim').classList.add('on');
  requestAnimationFrame(() => p.classList.add('in')); openPop = p; return p;
}
document.addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target) && !e.target.closest('[data-pop]')) closePop(); }, true);
function menu(items, anchor) {
  return popover(h('div', { class: 'menu' }, items.filter(Boolean).map(it => it === '-' ? h('hr') : h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), onclick: () => { closePop(); it.run(); } }, h('span', { class: 'mi' }, it.icon || ''), h('span', {}, it.label), it.hint ? h('kbd', {}, it.hint) : null))), anchor);
}

/* ---------- sidebar tree ---------- */
const expanded = new Set(JSON.parse(localStorage.getItem('ln-expanded') || '[]'));
const saveExpanded = () => localStorage.setItem('ln-expanded', JSON.stringify([...expanded]));
function renderTree() {
  const root = $('#tree'); root.innerHTML = '';
  const build = (pid, depth) => store.children(pid).map(p => {
    const kids = store.children(p.id), open = expanded.has(p.id);
    const row = h('div', { class: 'node' + (current && current.id === p.id ? ' active' : ''), style: `--d:${depth}`, draggable: mobile() ? null : 'true', 'data-id': p.id },
      h('button', { class: 'twisty' + (open ? ' open' : '') + (kids.length ? '' : ' empty'), 'aria-label': '펼치기', onclick: e => { e.stopPropagation(); open ? expanded.delete(p.id) : expanded.add(p.id); saveExpanded(); renderTree(); } }, h('i')),
      h('span', { class: 'n-icon' }, p.icon || '📄'), h('span', { class: 'n-title' }, p.title || '제목 없음'),
      h('button', { class: 'n-act', 'data-pop': '', 'aria-label': '더보기', onclick: e => { e.stopPropagation(); pageMenu(p, e.currentTarget); } }, '⋯'),
      h('button', { class: 'n-act', 'aria-label': '하위 페이지', onclick: async e => { e.stopPropagation(); const c = await store.create({ parentId: p.id }); expanded.add(p.id); saveExpanded(); go(c.id); } }, '＋'));
    row.addEventListener('click', () => go(p.id));
    treeDnD(row, p);
    const wrap = h('div', { class: 'branch' }, row);
    if (open && kids.length) wrap.append(h('div', { class: 'kids' }, build(p.id, depth + 1)));
    return wrap;
  });
  root.append(...build(null, 0));
  if (!store.all().length) root.append(h('p', { class: 'empty-tree' }, '페이지가 없어요'));
}
let dragId = null;
function treeDnD(row, p) {
  row.addEventListener('dragstart', e => { dragId = p.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.title || ''); row.classList.add('dragging'); });
  row.addEventListener('dragend', () => { dragId = null; $$('.node').forEach(n => n.classList.remove('dragging', 'drop-in', 'drop-before', 'drop-after')); });
  row.addEventListener('dragover', e => {
    if (!dragId || dragId === p.id) return; e.preventDefault();
    const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
    row.classList.toggle('drop-before', y < .25); row.classList.toggle('drop-after', y > .75); row.classList.toggle('drop-in', y >= .25 && y <= .75);
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-in', 'drop-before', 'drop-after'));
  row.addEventListener('drop', async e => {
    e.preventDefault(); const id = dragId; if (!id) return;
    const mode = row.classList.contains('drop-in') ? 'in' : row.classList.contains('drop-before') ? 'before' : 'after';
    if (mode === 'in') { await store.move(id, p.id, Date.now()); expanded.add(p.id); saveExpanded(); }
    else { const sib = store.children(p.parentId).filter(s => s.id !== id); const i = sib.findIndex(s => s.id === p.id) + (mode === 'after' ? 1 : 0); sib.splice(i, 0, store.pages.get(id)); for (const [k, s] of sib.entries()) { s.order = k; if (s.id === id) s.parentId = p.parentId || null; } if (store.descendants(id).some(d => d.id === p.parentId)) return; await store.saveMany(sib); }
    renderTree(); renderCrumbs();
  });
}
function pageMenu(p, anchor) {
  menu([
    { icon: '＋', label: '하위 페이지 추가', run: async () => { const c = await store.create({ parentId: p.id }); expanded.add(p.id); saveExpanded(); go(c.id); } },
    { icon: '⧉', label: '복제', run: () => duplicate(p) },
    { icon: '↪', label: '다른 곳으로 옮기기', run: () => movePicker(p) },
    { icon: '⤓', label: '내보내기', run: () => exportSheet(p) },
    '-',
    { icon: '🗑', label: '삭제', danger: true, run: () => removePage(p) },
  ], anchor);
}
async function duplicate(p) {
  const map = new Map(); const all = [p, ...store.descendants(p.id)]; all.forEach(x => map.set(x.id, newPage().id));
  const copies = all.map(x => ({ ...structuredClone(x), id: map.get(x.id), parentId: x.id === p.id ? p.parentId : map.get(x.parentId), title: x.id === p.id ? (x.title || '제목 없음') + ' 사본' : x.title, order: x.id === p.id ? p.order + .5 : x.order, updatedAt: Date.now() }));
  await store.saveMany(copies); renderTree(); go(copies[0].id); toast('복제했어요');
}
async function removePage(p) {
  const all = [p, ...store.descendants(p.id)].map(x => structuredClone(x));
  await store.remove(p.id);
  if (!current || !store.get(current.id)) { const next = store.children(p.parentId)[0] || store.get(p.parentId) || store.children(null)[0]; next ? go(next.id) : newRootPage(); }
  renderTree();
  toast(`"${p.title || '제목 없음'}"${all.length > 1 ? ` 외 ${all.length - 1}개` : ''} 삭제됨`, { label: '되돌리기', run: async () => { await store.saveMany(all); renderTree(); go(p.id); } });
}
function movePicker(p) {
  const banned = new Set([p.id, ...store.descendants(p.id).map(d => d.id)]);
  pagePicker('어디로 옮길까요?', async target => { await store.move(p.id, target ? target.id : null, Date.now()); if (target) { expanded.add(target.id); saveExpanded(); } renderTree(); renderCrumbs(); toast('옮겼어요'); }, { exclude: banned, allowRoot: true });
}
async function newRootPage() { const p = await store.create({}); go(p.id); return p; }

/* ---------- routing ---------- */
function go(id) { if (location.hash !== '#/p/' + id) location.hash = '/p/' + id; else openPage(id); if (mobile()) document.body.classList.remove('nav-open'); }
addEventListener('hashchange', () => { const m = location.hash.match(/^#\/p\/([\w-]+)/); if (m) openPage(m[1]); });

function renderCrumbs() {
  const c = $('#crumbs'); c.innerHTML = ''; if (!current) return;
  [...store.ancestors(current.id), current].forEach((p, i, a) => { c.append(h('button', { class: 'crumb', onclick: () => go(p.id) }, (p.icon ? p.icon + ' ' : '') + (p.title || '제목 없음'))); if (i < a.length - 1) c.append(h('span', { class: 'sep' }, '/')); });
}
function setSaved(state) { const s = $('#saved'); s.dataset.state = state; s.textContent = state === 'saving' ? '저장 중…' : '저장됨'; }

/* ---------- page header ---------- */
function renderHeader() {
  const p = current, head = $('#page-head'); head.innerHTML = '';
  const cover = h('div', { class: 'cover' + (p.cover ? ' has' : '') });
  if (p.cover) { if (COVERS[p.cover]) cover.style.background = COVERS[p.cover]; else cover.style.backgroundImage = `url("${p.cover}")`; cover.append(h('div', { class: 'cover-acts' }, h('button', { class: 'chip', 'data-pop': '', onclick: e => coverPicker(e.currentTarget) }, '커버 바꾸기'), h('button', { class: 'chip', onclick: () => update({ cover: '' }) }, '제거'))); }
  const tools = h('div', { class: 'head-tools' },
    !p.icon ? h('button', { class: 'ghost', 'data-pop': '', onclick: e => emojiPicker(e.currentTarget, em => update({ icon: em })) }, '☺︎ 아이콘 추가') : null,
    !p.cover ? h('button', { class: 'ghost', 'data-pop': '', onclick: e => coverPicker(e.currentTarget) }, '▧ 커버 추가') : null);
  const icon = p.icon ? h('button', { class: 'page-icon', 'data-pop': '', 'aria-label': '아이콘 바꾸기', onclick: e => emojiPicker(e.currentTarget, em => update({ icon: em }), true) }, p.icon) : null;
  const title = h('textarea', { class: 'title', rows: 1, placeholder: '제목 없음', 'aria-label': '제목', spellcheck: 'false' }); title.value = p.title;
  const fit = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
  title.addEventListener('input', () => { current.title = title.value.replace(/\n/g, ''); fit(); scheduleSave(); renderTreeTitle(); });
  title.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); editor.commands.focus('start'); } if (e.key === 'ArrowDown') { e.preventDefault(); editor.commands.focus('start'); } });
  head.append(cover, h('div', { class: 'head-inner' + (p.cover ? ' with-cover' : '') }, icon, tools, title));
  requestAnimationFrame(fit);
}
function renderTreeTitle() { const n = $(`.node[data-id="${current.id}"] .n-title`); if (n) n.textContent = current.title || '제목 없음'; const c = $('#crumbs .crumb:last-child'); if (c) c.textContent = (current.icon ? current.icon + ' ' : '') + (current.title || '제목 없음'); document.title = (current.title || '제목 없음') + ' · 라이트 노트'; }
async function update(patch) { Object.assign(current, patch); await store.save(current); renderHeader(); renderTree(); renderCrumbs(); }

const EMOJIS = '📄📝📌📎📚📖🗂️🗒️✏️🖋️💡✨⭐️🌙☀️🌈🔥💜💟🩷🤍🤎🧸🐻🐰🐱🐶🌸🌷🌿🍀🌊☕️🍰🍓🍑🍋🎂🎁🎈🎉🎵🎬📷🎨🧩🎯🚀✈️🏠🏝️🗺️🧭⏰📅✅☑️❗️❓💬💼💰📈📊🧪💻⌨️🔒🔑🛠️⚙️🧠❤️‍🔥🫶🙌👀🍜🍣🍕🥐🧁🍷🌏🗼🏯🛍️💌🏃🧘🛁🌱'.match(/\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic})*/gu);
function emojiPicker(anchor, pick, removable) {
  const input = h('input', { class: 'field', placeholder: '직접 입력 (이모지 붙여넣기)', maxlength: 8 });
  const grid = h('div', { class: 'emoji-grid' }, EMOJIS.map(e => h('button', { onclick: () => { closePop(); pick(e); } }, e)));
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && input.value.trim()) { closePop(); pick(input.value.trim()); } });
  popover(h('div', { class: 'picker' }, h('div', { class: 'picker-row' }, input, removable ? h('button', { class: 'chip', onclick: () => { closePop(); pick(''); } }, '제거') : null), grid), anchor);
}
function coverPicker(anchor) {
  const file = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; const { compressImage } = await convert(); const r = new FileReader(); r.onload = async () => { closePop(); update({ cover: await compressImage(r.result, 1800) }); }; r.readAsDataURL(f); });
  popover(h('div', { class: 'picker' }, h('p', { class: 'picker-label' }, '파스텔 커버'), h('div', { class: 'cover-grid' }, Object.entries(COVERS).map(([k, v]) => h('button', { style: `background:${v}`, 'aria-label': k, onclick: () => { closePop(); update({ cover: k }); } }))), h('button', { class: 'btn soft wide', onclick: () => file.click() }, '🖼 사진 올리기'), file), anchor);
}

/* ---------- slash menu ---------- */
const pickImage = ed => { const f = h('input', { type: 'file', accept: 'image/*', multiple: '' }); f.onchange = () => insertImages(ed, [...f.files]); f.click(); };
async function insertImages(ed, files, pos) {
  const { fileToImage } = await convert();
  for (const f of files.filter(f => f.type.startsWith('image/'))) { const src = await fileToImage(f); const c = ed.chain().focus(); (pos != null ? c.insertContentAt(pos, { type: 'image', attrs: { src, alt: f.name.replace(/\.\w+$/, '') } }) : c.setImage({ src, alt: f.name.replace(/\.\w+$/, '') })).run(); }
}
const COMMANDS = [
  { k: '텍스트 text p', label: '텍스트', icon: 'T', desc: '그냥 문단', run: e => e.chain().focus().setParagraph().run() },
  { k: '제목1 heading h1 #', label: '제목 1', icon: 'H1', desc: '큰 제목', run: e => e.chain().focus().setHeading({ level: 1 }).run() },
  { k: '제목2 heading h2 ##', label: '제목 2', icon: 'H2', desc: '중간 제목', run: e => e.chain().focus().setHeading({ level: 2 }).run() },
  { k: '제목3 heading h3 ###', label: '제목 3', icon: 'H3', desc: '작은 제목', run: e => e.chain().focus().setHeading({ level: 3 }).run() },
  { k: '글머리 목록 bullet list ul -', label: '글머리 목록', icon: '•', desc: '- 로도 시작', run: e => e.chain().focus().toggleBulletList().run() },
  { k: '번호 목록 numbered ordered ol 1.', label: '번호 목록', icon: '1.', desc: '1. 로도 시작', run: e => e.chain().focus().toggleOrderedList().run() },
  { k: '할일 체크 todo task check []', label: '할 일', icon: '☑', desc: '[] 로도 시작', run: e => e.chain().focus().toggleTaskList().run() },
  { k: '토글 toggle details 접기', label: '토글', icon: '▸', desc: '접고 펼치는 블록', run: e => e.chain().focus().setDetails().run() },
  { k: '인용 quote blockquote >', label: '인용', icon: '❝', desc: '> 로도 시작', run: e => e.chain().focus().toggleBlockquote().run() },
  { k: '콜아웃 callout 강조 메모', label: '콜아웃', icon: '💡', desc: '눈에 띄는 메모 상자', run: e => e.chain().focus().setCallout().run() },
  { k: '코드 code ```', label: '코드', icon: '</>', desc: '문법 강조 코드 블록', run: e => e.chain().focus().toggleCodeBlock().run() },
  { k: '구분선 divider hr ---', label: '구분선', icon: '—', desc: '--- 로도 만들기', run: e => e.chain().focus().setHorizontalRule().run() },
  { k: '이미지 사진 image picture', label: '이미지', icon: '🖼', desc: '붙여넣기·드래그도 돼요', run: e => pickImage(e) },
  { k: '표 table 테이블', label: '표', icon: '▦', desc: '3 × 3 표', run: e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { k: '하위페이지 page subpage 새페이지', label: '하위 페이지', icon: '📄', desc: '이 페이지 안에 새 페이지', run: async e => { const c = await store.create({ parentId: current.id }); e.chain().focus().insertContent([{ type: 'paragraph', content: [{ type: 'text', text: '📄 제목 없음', marks: [{ type: 'link', attrs: { href: '#/p/' + c.id } }] }] }]).run(); await flushSave(); expanded.add(current.id); saveExpanded(); go(c.id); } },
  { k: '페이지링크 link mention 링크 연결', label: '페이지 링크', icon: '↗', desc: '다른 페이지로 연결', run: e => pagePicker('어떤 페이지를 연결할까요?', t => t && e.chain().focus().insertContent({ type: 'text', text: (t.icon ? t.icon + ' ' : '') + (t.title || '제목 없음'), marks: [{ type: 'link', attrs: { href: '#/p/' + t.id } }] }).insertContent(' ').run()) },
];
const filterCmds = q => { q = q.toLowerCase().replace(/\s/g, ''); return COMMANDS.filter(c => !q || (c.label + c.k).toLowerCase().replace(/\s/g, '').includes(q)); };
const Slash = Extension.create({
  name: 'slash',
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor, char: '/', allowSpaces: false, startOfLine: false,
      allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
      items: ({ query }) => filterCmds(query),
      command: ({ editor, range, props }) => { editor.chain().focus().deleteRange(range).run(); props.run(editor); },
      render: () => {
        let el, items = [], sel = 0, cmd;
        const draw = () => { el.innerHTML = ''; if (!items.length) { el.append(h('p', { class: 'slash-empty' }, '결과 없음')); return; } items.forEach((it, i) => el.append(h('button', { class: 'slash-item' + (i === sel ? ' on' : ''), onmousedown: e => { e.preventDefault(); cmd(it); } }, h('span', { class: 'si' }, it.icon), h('span', { class: 'st' }, h('b', {}, it.label), h('small', {}, it.desc))))); const on = el.querySelector('.on'); on && on.scrollIntoView({ block: 'nearest' }); };
        const place = r => { if (!r) return; const w = el.offsetWidth, hh = el.offsetHeight; let x = Math.min(innerWidth - w - 8, Math.max(8, r.left)); let y = r.bottom + 8; const vh = (visualViewport ? visualViewport.height + visualViewport.offsetTop : innerHeight); if (y + hh > vh - 8) y = Math.max(8, r.top - hh - 8); el.style.transform = `translate(${x}px,${y}px)`; };
        return {
          onStart: p => { el = h('div', { class: 'slash' }); document.body.append(el); items = p.items; cmd = p.command; sel = 0; draw(); place(p.clientRect && p.clientRect()); requestAnimationFrame(() => el.classList.add('in')); },
          onUpdate: p => { items = p.items; cmd = p.command; sel = 0; draw(); place(p.clientRect && p.clientRect()); },
          onKeyDown: ({ event }) => {
            if (event.key === 'ArrowDown') { sel = (sel + 1) % Math.max(1, items.length); draw(); return true; }
            if (event.key === 'ArrowUp') { sel = (sel - 1 + items.length) % Math.max(1, items.length); draw(); return true; }
            if (event.key === 'Enter' || event.key === 'Tab') { if (items[sel]) { cmd(items[sel]); return true; } return false; }
            if (event.key === 'Escape') { el.remove(); return true; } return false;
          },
          onExit: () => { const e = el; e.classList.remove('in'); setTimeout(() => e.remove(), 180); },
        };
      },
    })];
  },
});
const Keys = Extension.create({
  name: 'lnKeys',
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-0': () => this.editor.commands.setParagraph(),
      'Mod-Alt-4': () => this.editor.commands.toggleTaskList(),
      'Mod-Alt-5': () => this.editor.commands.toggleCodeBlock(),
      'Mod-Alt-6': () => this.editor.commands.toggleBlockquote(),
      'Mod-k': () => { linkPrompt(this.editor); return true; },
      'Mod-d': () => { const { $from } = this.editor.state.selection; const n = $from.node(1); if (!n) return false; const end = $from.after(1); return this.editor.chain().insertContentAt(end, n.toJSON()).run(); },
    };
  },
});

/* ---------- bubble menu ---------- */
function linkPrompt(ed) {
  const prev = ed.getAttributes('link').href || '';
  const url = prompt('링크 주소 (비우면 링크 제거)', prev); if (url === null) return;
  if (!url.trim()) ed.chain().focus().extendMarkRange('link').unsetLink().run();
  else ed.chain().focus().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|#)/.test(url) ? url : 'https://' + url.trim() }).run();
}
function bubbleEl() {
  const b = (label, title, fn, active) => { const el = h('button', { title, 'data-act': active || '', onmousedown: e => e.preventDefault(), onclick: () => fn(editor) }, label); return el; };
  return h('div', { class: 'bubble' },
    b('B', `굵게 ${MOD}B`, e => e.chain().focus().toggleBold().run(), 'bold'),
    b('I', `기울임 ${MOD}I`, e => e.chain().focus().toggleItalic().run(), 'italic'),
    b('U', `밑줄 ${MOD}U`, e => e.chain().focus().toggleUnderline().run(), 'underline'),
    b('S', '취소선', e => e.chain().focus().toggleStrike().run(), 'strike'),
    b('</>', '인라인 코드', e => e.chain().focus().toggleCode().run(), 'code'),
    b('🔗', `링크 ${MOD}K`, e => linkPrompt(e), 'link'),
    h('i', { class: 'bsep' }),
    b('H1', '제목 1', e => e.chain().focus().toggleHeading({ level: 1 }).run(), 'h1'),
    b('H2', '제목 2', e => e.chain().focus().toggleHeading({ level: 2 }).run(), 'h2'),
    b('☑', '할 일', e => e.chain().focus().toggleTaskList().run(), 'taskList'));
}
function tableBar() {
  const b = (l, t, f) => h('button', { title: t, onmousedown: e => e.preventDefault(), onclick: () => f(editor.chain().focus()).run() }, l);
  return h('div', { class: 'bubble table-bar' }, b('+행', '아래에 행 추가', c => c.addRowAfter()), b('+열', '오른쪽에 열 추가', c => c.addColumnAfter()), b('−행', '행 삭제', c => c.deleteRow()), b('−열', '열 삭제', c => c.deleteColumn()), b('머리글', '머리글 행 전환', c => c.toggleHeaderRow()), b('🗑', '표 삭제', c => c.deleteTable()));
}

/* ---------- editor ---------- */
let bubble, tbar, handle;
function makeEditor(p) {
  if (editor) editor.destroy();
  bubble = bubbleEl(); tbar = tableBar();
  handle = h('div', { class: 'drag-handle', title: '끌어서 옮기기 · 클릭해서 메뉴' }, h('i'), h('i'), h('i'), h('i'), h('i'), h('i'));
  let hovered = null;
  handle.addEventListener('click', e => {
    if (!hovered) return; const pos = hovered.pos;
    menu([
      { icon: '⧉', label: '복제', run: () => { const n = editor.state.doc.nodeAt(pos); n && editor.chain().insertContentAt(pos + n.nodeSize, n.toJSON()).run(); } },
      { icon: 'T', label: '텍스트로 바꾸기', run: () => editor.chain().setNodeSelection(pos).setParagraph().run() },
      { icon: '🗑', label: '삭제', danger: true, run: () => { const n = editor.state.doc.nodeAt(pos); n && editor.chain().deleteRange({ from: pos, to: pos + n.nodeSize }).run(); } },
    ], handle);
  });
  editor = new Editor({
    element: $('#editor'),
    extensions: [...baseExtensions(), Slash, Keys,
      Placeholder.configure({ placeholder: ({ node, pos }) => node.type.name === 'heading' ? `제목 ${node.attrs.level}` : node.type.name === 'detailsSummary' ? '토글 제목' : pos === 0 ? "'/'를 눌러 블록 추가, 아니면 그냥 쓰기 시작" : "'/' 로 블록 추가", includeChildren: true, showOnlyCurrent: true }),
      BubbleMenu.configure({ element: bubble, pluginKey: 'bubble', shouldShow: ({ editor: e, state }) => !state.selection.empty && !e.isActive('codeBlock') && !e.isActive('image') && state.selection.constructor.name !== 'NodeSelection' && !mobileTyping(), options: { placement: 'top', offset: 8 } }),
      BubbleMenu.extend({ name: 'tableBubble' }).configure({ element: tbar, pluginKey: 'tableBubble', shouldShow: ({ editor: e }) => e.isActive('table'), options: { placement: 'top-start', offset: 8 }, getReferencedVirtualElement: () => { const n = editor.view.domAtPos(editor.state.selection.from).node; const t = (n.nodeType === 3 ? n.parentElement : n).closest('table'); return t ? { getBoundingClientRect: () => t.getBoundingClientRect() } : null; } }),
      DragHandle.configure({ render: () => handle, onNodeChange: ({ node, pos }) => { hovered = node ? { node, pos } : null; } }),
    ],
    content: p.content,
    autofocus: false,
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'false' },
      handleClick: (view, pos, ev) => {
        const a = ev.target.closest && ev.target.closest('a[href]'); if (!a) return false;
        const href = a.getAttribute('href');
        if (href.startsWith('#/p/')) { ev.preventDefault(); go(href.slice(4)); return true; }
        if (ev.metaKey || ev.ctrlKey || !view.editable || mobile()) { window.open(href, '_blank', 'noopener'); return true; }
        return false;
      },
      handleDOMEvents: {
        click: (view, ev) => { const c = ev.target.closest && ev.target.closest('.callout'); if (c && ev.offsetX < 40 && ev.target === c) { const pos = view.posAtDOM(c, 0) - 1; const n = view.state.doc.nodeAt(pos); if (n && n.type.name === 'callout') emojiPicker(c, em => editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, null, { ...n.attrs, emoji: em || '💡' }); return true; }).run()); return true; } return false; },
      },
      handlePaste: (view, ev) => {
        const files = [...(ev.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
        if (files.length) { insertImages(editor, files); return true; }
        const html = ev.clipboardData?.getData('text/html'), text = ev.clipboardData?.getData('text/plain');
        if (!html && text && !editor.isActive('codeBlock') && /(^|\n)(#{1,6} |[-*+] |\d+\. |> |```|\|.+\||- \[[ x]\] )/.test(text) && text.includes('\n')) {
          convert().then(async c => editor.chain().focus().insertContent((await c.normalizeHTML(c.mdToHTML(text))).html).run()); return true;
        }
        if (html && /<(details|aside|figure|input)|class="(to-do|callout|toggle)/.test(html)) { convert().then(async c => editor.chain().focus().insertContent((await c.normalizeHTML(html)).html).run()); return true; }
        return false;
      },
      handleDrop: (view, ev, slice, moved) => {
        if (moved) return false; const files = [...(ev.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
        if (!files.length) return false; const c = view.posAtCoords({ left: ev.clientX, top: ev.clientY }); insertImages(editor, files, c ? c.pos : null); return true;
      },
    },
    onUpdate: () => { setSaved('saving'); scheduleSave(); },
    onSelectionUpdate: ({ editor: e }) => updateBubbleState(e),
    onTransaction: ({ editor: e }) => updateBubbleState(e),
    onFocus: () => document.body.classList.add('editing'),
    onBlur: () => setTimeout(() => { if (!editor || !editor.isFocused) document.body.classList.remove('editing'); }, 150),
  });
}
const mobileTyping = () => false;
function updateBubbleState(e) {
  $$('[data-act]', bubble).forEach(b => { const a = b.dataset.act; b.classList.toggle('on', a === 'h1' ? e.isActive('heading', { level: 1 }) : a === 'h2' ? e.isActive('heading', { level: 2 }) : !!a && e.isActive(a)); });
  $('#mt-undo') && ($('#mt-undo').disabled = !e.can().undo()); $('#mt-redo') && ($('#mt-redo').disabled = !e.can().redo());
}
function scheduleSave() { clearTimeout(saveTimer); setSaved('saving'); saveTimer = setTimeout(flushSave, 450); }
async function flushSave() {
  clearTimeout(saveTimer); if (!current || !editor) return;
  current.content = editor.getJSON(); current.text = editor.getText({ blockSeparator: ' ' }).replace(/\s+/g, ' ').slice(0, 20000);
  await store.save(current, { silent: true }); setSaved('saved');
}
addEventListener('pagehide', flushSave); document.addEventListener('visibilitychange', () => document.hidden && flushSave());

async function openPage(id) {
  const p = store.get(id); if (!p) { const f = store.children(null)[0]; if (f && f.id !== id) return go(f.id); return; }
  if (current && editor && current.id !== id) await flushSave();
  current = p; localStorage.setItem('ln-last', id);
  store.ancestors(id).forEach(a => expanded.add(a.id));
  const main = $('#page'); main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
  renderHeader(); makeEditor(p); renderTree(); renderCrumbs(); renderTreeTitle(); setSaved('saved');
  $('#scroller').scrollTop = 0;
  if (!p.title && !p.text) setTimeout(() => $('#page-head .title').focus(), 60);
}

/* ---------- search & page picker ---------- */
function snippet(text, q) { const i = text.toLowerCase().indexOf(q.toLowerCase()); if (i < 0) return text.slice(0, 80); const s = Math.max(0, i - 24); return (s ? '…' : '') + text.slice(s, i + q.length + 56); }
function pagePicker(title, onPick, { exclude = new Set(), allowRoot = false, search = false } = {}) {
  const input = h('input', { class: 'field big', placeholder: search ? '페이지 제목이나 내용 검색' : '페이지 검색', autocomplete: 'off', enterkeyhint: 'go' });
  const list = h('div', { class: 'results' }); let sel = 0, rows = [];
  const draw = () => {
    const q = input.value.trim(); list.innerHTML = '';
    let pages = store.all().filter(p => !exclude.has(p.id));
    if (q) pages = pages.map(p => { const t = (p.title || '').toLowerCase().includes(q.toLowerCase()) ? 2 : 0, b = (p.text || '').toLowerCase().includes(q.toLowerCase()) ? 1 : 0; return { p, s: t + b }; }).filter(x => x.s).sort((a, b) => b.s - a.s || b.p.updatedAt - a.p.updatedAt).map(x => x.p);
    else pages.sort((a, b) => b.updatedAt - a.updatedAt);
    rows = [...(allowRoot && !q ? [null] : []), ...pages.slice(0, 50)];
    if (!rows.length) list.append(h('p', { class: 'muted pad' }, '찾는 페이지가 없어요'));
    rows.forEach((p, i) => {
      const path = p ? store.ancestors(p.id).map(a => a.title || '제목 없음').join(' / ') : '';
      const r = h('button', { class: 'result' + (i === sel ? ' on' : ''), onclick: () => { closePop(); onPick(p); } }, h('span', { class: 'r-icon' }, p ? p.icon || '📄' : '🏠'), h('span', { class: 'r-body' }, h('b', {}, p ? p.title || '제목 없음' : '맨 위 (최상위)'), h('small', {}, q && p && p.text && !(p.title || '').toLowerCase().includes(q.toLowerCase()) ? snippet(p.text, q) : path)));
      list.append(r);
    });
    const on = list.querySelector('.on'); on && on.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', e => { if (e.isComposing) return; if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); draw(); } if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); } if (e.key === 'Enter' && rows.length) { e.preventDefault(); const p = rows[sel]; closePop(); onPick(p); } if (e.key === 'Escape') closePop(); });
  const pop = popover(h('div', { class: 'modal search-modal' }, h('p', { class: 'modal-title' }, title), input, list), null, { sheet: true });
  pop.classList.add('center'); draw(); setTimeout(() => input.focus(), 50);
}
const openSearch = () => pagePicker('검색', p => p && go(p.id), { search: true });

/* ---------- import / export ---------- */
async function exportSheet(page = current) {
  const run = async (label, fn) => { closePop(); const t0 = performance.now(); try { setBusy(label + ' 만드는 중…'); const r = await fn(await convert()); download(r); toast(`${r.name} 저장했어요`); } catch (e) { console.error(e); toast('내보내기 실패: ' + e.message); } finally { setBusy(null); } };
  const kids = page ? store.descendants(page.id).length : 0;
  const b = (icon, label, desc, fn) => h('button', { class: 'opt', onclick: fn }, h('span', { class: 'opt-i' }, icon), h('span', {}, h('b', {}, label), h('small', {}, desc)));
  popover(h('div', { class: 'modal' }, h('p', { class: 'modal-title' }, '내보내기'),
    page ? h('p', { class: 'modal-sub' }, `이 페이지 · ${page.icon || '📄'} ${page.title || '제목 없음'}`) : null,
    page ? h('div', { class: 'opts' },
      b('Ⓜ︎', 'Markdown', '이미지가 있으면 images 폴더와 함께 zip', () => run('Markdown', c => c.exportPage(page, 'md', store))),
      b('🌐', 'HTML', '이미지까지 들어간 파일 하나', () => run('HTML', c => c.exportPage(page, 'html', store))),
      b('📄', 'PDF', '인쇄 창에서 "PDF로 저장"', () => { closePop(); flushSave().then(() => print()); }),
      b('Ｗ', 'Word (DOCX)', '워드·한글·구글 문서에서 열기', () => run('DOCX', c => c.exportPage(page, 'docx', store))),
      kids ? b('🗂', `하위 페이지 포함 Markdown (${kids + 1}개)`, '폴더 구조 그대로 zip', () => run('Markdown', c => c.exportWorkspace(store, 'md', page.id))) : null) : null,
    h('p', { class: 'modal-sub' }, `워크스페이스 전체 · ${store.all().length}개 페이지`),
    h('div', { class: 'opts' },
      b('🗂', 'Markdown zip', '페이지 트리 = 폴더 구조, images 폴더 포함', () => run('Markdown zip', c => c.exportWorkspace(store, 'md'))),
      b('🌐', 'HTML zip', '브라우저로 바로 열 수 있는 사이트', () => run('HTML zip', c => c.exportWorkspace(store, 'html'))),
      b('💾', '백업 (JSON)', '100% 그대로 복원되는 백업', () => run('백업', c => c.exportWorkspace(store, 'json'))))), null, { sheet: true }).classList.add('center');
}
function importSheet(parentId = null) {
  const file = h('input', { type: 'file', multiple: '', accept: '.md,.markdown,.txt,.html,.htm,.docx,.zip,.csv,.json', hidden: '' });
  file.addEventListener('change', () => { closePop(); doImport([...file.files], parentId); });
  const zone = h('div', { class: 'dropzone', onclick: () => file.click() }, h('div', { class: 'dz-i' }, '⤒'), h('b', {}, '파일을 끌어다 놓거나 눌러서 고르기'), h('small', {}, 'Notion 내보내기 zip (Markdown & CSV / HTML) · Markdown · HTML · Word(.docx) · CSV · 백업 JSON'));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); }); zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); closePop(); doImport([...e.dataTransfer.files], parentId); });
  popover(h('div', { class: 'modal' }, h('p', { class: 'modal-title' }, '가져오기'), zone, file,
    h('p', { class: 'tip' }, 'Notion: 설정 → 워크스페이스 → 내보내기에서 "Markdown & CSV" 또는 "HTML" 로 받은 zip을 그대로 넣으면 페이지 트리, 이미지, 페이지 간 링크까지 다시 이어 붙여요.')), null, { sheet: true }).classList.add('center');
}
async function doImport(files, parentId = null) {
  if (!files.length) return; setBusy('가져오는 중…');
  try {
    const c = await convert(); const { pages, report } = await c.importFiles(files);
    if (!pages.length) { toast(report.errors[0] || '가져올 페이지가 없어요'); return; }
    const roots = pages.filter(p => !p.parentId || !pages.some(q => q.id === p.parentId));
    let o = Date.now(); roots.forEach(p => { p.parentId = parentId; p.order = o++; });
    await store.saveMany(pages); if (parentId) expanded.add(parentId); roots.forEach(r => pages.some(p => p.parentId === r.id) && expanded.add(r.id)); saveExpanded();
    renderTree(); go(roots[0].id);
    toast(`${pages.length}개 페이지 가져옴 · 이미지 ${report.images} · 링크 ${report.links}` + (report.missing.length ? ` · 못 찾은 이미지 ${report.missing.length}` : '') + (report.errors.length ? ` · 실패 ${report.errors.length}` : ''));
    window.__lastImport = report;
  } catch (e) { console.error(e); toast('가져오기 실패: ' + e.message); } finally { setBusy(null); }
}
function setBusy(msg) { const b = $('#busy'); b.textContent = msg || ''; b.classList.toggle('on', !!msg); }
// drop files anywhere outside the editor to import
addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files') && !e.target.closest('.ProseMirror')) e.preventDefault(); });
addEventListener('drop', e => { if (e.target.closest('.ProseMirror') || e.target.closest('.dropzone') || !e.dataTransfer?.files.length) return; e.preventDefault(); doImport([...e.dataTransfer.files]); });

/* ---------- theme, shortcuts, mobile ---------- */
function setTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem('ln-theme', t); $('meta[name=theme-color]').content = t === 'dark' ? '#1E1B18' : '#FAF7F2'; $('#theme-btn').textContent = t === 'dark' ? '☀︎ 라이트 모드' : '☾ 다크 모드'; }
function shortcutsSheet() {
  const rows = [[`${MOD} K`, '검색 (에디터 밖) / 링크 (글자 선택 시)'], [`${MOD} ⇧ P`, '새 페이지'], [`${MOD} \\`, '사이드바 열고 닫기'], [`${MOD} Z / ${MOD} ⇧ Z`, '실행 취소 / 다시 실행'], [`${MOD} B · I · U`, '굵게 · 기울임 · 밑줄'], [`${MOD} E`, '인라인 코드'], [`${MOD} ⌥ 1·2·3`, '제목 1·2·3'], [`${MOD} ⌥ 0`, '텍스트'], [`${MOD} ⇧ 7 / 8`, '번호 / 글머리 목록'], [`${MOD} ⌥ 4`, '할 일'], [`${MOD} ⌥ 5`, '코드 블록'], [`${MOD} ⌥ 6`, '인용'], [`${MOD} D`, '블록 복제'], ['/', '블록 메뉴'], ['Tab / ⇧ Tab', '목록 들여쓰기 / 내어쓰기'], ['# ## ###', '제목'], ['- * +', '글머리 목록'], ['1.', '번호 목록'], ['[] / [x]', '할 일'], ['>', '인용'], ['```js', '코드 블록'], ['---', '구분선'], ['**굵게** *기울임* ~~취소~~ `코드`', '인라인 서식']];
  popover(h('div', { class: 'modal' }, h('p', { class: 'modal-title' }, '단축키 · 마크다운'), h('div', { class: 'keys' }, rows.map(([k, v]) => h('div', { class: 'key-row' }, h('kbd', {}, k), h('span', {}, v))))), null, { sheet: true }).classList.add('center');
}
addEventListener('keydown', e => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (e.key === 'Escape' && openPop) { closePop(); return; }
  if (!mod) return;
  const inEditor = e.target.closest && e.target.closest('.ProseMirror');
  if (e.key.toLowerCase() === 'k' && !(inEditor && editor && !editor.state.selection.empty)) { e.preventDefault(); e.stopPropagation(); openSearch(); }
  else if (e.key.toLowerCase() === 'p' && e.shiftKey) { e.preventDefault(); newRootPage(); }
  else if (e.key === '\\') { e.preventDefault(); document.body.classList.toggle(mobile() ? 'nav-open' : 'nav-closed'); }
  else if (e.key.toLowerCase() === 's') { e.preventDefault(); flushSave().then(() => toast('저장했어요 · 자동 저장도 켜져 있어요')); }
  else if (e.key === '/' ) { e.preventDefault(); shortcutsSheet(); }
}, true);
function mobileToolbar() {
  const b = (id, label, fn, title) => h('button', { id, title, 'aria-label': title, onmousedown: e => e.preventDefault(), onclick: () => fn(editor) }, label);
  const bar = h('div', { id: 'mtools', class: 'glass' },
    b('mt-slash', '＋', e => e.chain().focus().insertContent('/').run(), '블록 추가'),
    b('', '☑', e => e.chain().focus().toggleTaskList().run(), '할 일'),
    b('', '•', e => e.chain().focus().toggleBulletList().run(), '목록'),
    b('', 'H', e => e.chain().focus().toggleHeading({ level: 2 }).run(), '제목'),
    b('', '🖼', e => pickImage(e), '이미지'),
    b('', '⇥', e => e.chain().focus().sinkListItem(e.isActive('taskItem') ? 'taskItem' : 'listItem').run(), '들여쓰기'),
    b('', '⇤', e => e.chain().focus().liftListItem(e.isActive('taskItem') ? 'taskItem' : 'listItem').run(), '내어쓰기'),
    b('mt-undo', '↶', e => e.chain().focus().undo().run(), '실행 취소'),
    b('mt-redo', '↷', e => e.chain().focus().redo().run(), '다시 실행'),
    b('', '⌄', e => e.commands.blur(), '키보드 닫기'));
  document.body.append(bar);
  if (window.visualViewport) { const fit = () => { const off = innerHeight - visualViewport.height - visualViewport.offsetTop; bar.style.transform = `translateY(${-Math.max(0, off)}px)`; }; visualViewport.addEventListener('resize', fit); visualViewport.addEventListener('scroll', fit); }
}

/* ---------- boot ---------- */
async function boot() {
  setTheme(localStorage.getItem('ln-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  await store.load();
  if (!(await store.meta('seeded'))) { const seed = await seedPages(); await store.saveMany(seed); await store.setMeta('seeded', true); seed.filter(p => !p.parentId).forEach(p => expanded.add(p.id)); saveExpanded(); }
  $('#new-page').onclick = () => newRootPage();
  $('#search-btn').onclick = openSearch; $('#search-btn-m').onclick = openSearch;
  $('#import-btn').onclick = () => importSheet(); $('#export-btn').onclick = () => exportSheet(); $('#export-all').onclick = () => exportSheet(null);
  $('#more-btn').onclick = e => menu([{ icon: '⤓', label: '내보내기', run: () => exportSheet() }, { icon: '⤒', label: '여기에 가져오기', run: () => importSheet(current.id) }, { icon: '📄', label: 'PDF로 저장 / 인쇄', run: () => flushSave().then(() => print()) }, { icon: '⧉', label: '페이지 복제', run: () => duplicate(current) }, { icon: '↪', label: '옮기기', run: () => movePicker(current) }, { icon: '⌨︎', label: '단축키 · 마크다운', hint: `${MOD}/`, run: shortcutsSheet }, '-', { icon: '🗑', label: '페이지 삭제', danger: true, run: () => removePage(current) }], e.currentTarget);
  $('#theme-btn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#keys-btn').onclick = shortcutsSheet;
  $('#menu-btn').onclick = () => document.body.classList.add('nav-open'); $('#nav-scrim').onclick = () => document.body.classList.remove('nav-open');
  $('#collapse-btn').onclick = () => document.body.classList.toggle(mobile() ? 'nav-open' : 'nav-closed');
  $('#scrim').onclick = closePop;
  mobileToolbar();
  const m = location.hash.match(/^#\/p\/([\w-]+)/); const start = (m && store.get(m[1])) ? m[1] : (store.get(localStorage.getItem('ln-last')) ? localStorage.getItem('ln-last') : (store.children(null)[0] || await newRootPage()).id);
  renderTree(); if (location.hash !== '#/p/' + start) history.replaceState(null, '', '#/p/' + start); openPage(start);
  document.body.classList.add('ready');
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').then(r => r.update());
}
boot();
