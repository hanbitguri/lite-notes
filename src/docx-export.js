import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, AlignmentType, LevelFormat } from 'docx';

const MONO = 'Consolas';
async function imgInfo(src) {
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  let data = src, type = (src.match(/^data:image\/(\w+)/) || [, 'png'])[1];
  if (!['png', 'jpeg', 'jpg', 'gif', 'bmp'].includes(type)) { // webp/svg -> png
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); data = c.toDataURL('image/png'); type = 'png';
  }
  const bin = atob(data.split(',')[1]); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const w = Math.min(600, img.naturalWidth); return { bytes, type: type === 'jpeg' ? 'jpg' : type, w, h: Math.round(img.naturalHeight * w / img.naturalWidth) };
}
function runs(nodes = [], extra = {}) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') { out.push(new TextRun({ text: '', break: 1, ...extra })); continue; }
    if (n.type !== 'text') continue;
    const m = Object.fromEntries((n.marks || []).map(k => [k.type, k.attrs || true]));
    const o = { text: n.text, bold: !!m.bold || extra.bold, italics: !!m.italic, strike: !!m.strike, underline: m.underline ? {} : undefined, font: m.code ? MONO : extra.font, style: m.code ? 'CodeChar' : undefined, shading: m.code ? { type: ShadingType.CLEAR, fill: 'F3EDE3', color: 'auto' } : undefined, color: extra.color };
    if (m.link) {
      const href = m.link.href || '';
      if (/^https?:|^mailto:/.test(href)) out.push(new ExternalHyperlink({ link: href, children: [new TextRun({ ...o, style: 'Hyperlink' })] }));
      else out.push(new TextRun({ ...o, color: '7A5FD0' }));
    } else out.push(new TextRun(o));
  }
  return out;
}
export async function pageToDocx(page) {
  const body = []; let listInst = 0;
  const walk = async (nodes, ctx = {}) => {
    for (const n of nodes || []) {
      const c = n.content;
      switch (n.type) {
        case 'paragraph': body.push(new Paragraph({ children: runs(c, ctx.run), ...ctx.para })); break;
        case 'heading': body.push(new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][n.attrs.level - 1], children: runs(c) })); break;
        case 'bulletList': case 'orderedList': {
          const inst = ++listInst; const lvl = ctx.level ?? -1;
          for (const li of c || []) for (const [i, ch] of (li.content || []).entries()) {
            if (ch.type === 'paragraph' && i === 0) body.push(new Paragraph({ children: runs(ch.content), numbering: { reference: n.type === 'bulletList' ? 'bullets' : 'numbers', level: Math.min(lvl + 1, 5), instance: n.type === 'orderedList' ? inst : 0 } }));
            else await walk([ch], { ...ctx, level: lvl + 1, para: { indent: { left: 720 * (lvl + 2) } } });
          }
          break;
        }
        case 'taskList': { const lvl = ctx.level ?? -1;
          for (const li of c || []) for (const [i, ch] of (li.content || []).entries()) {
            if (ch.type === 'paragraph' && i === 0) body.push(new Paragraph({ indent: { left: 360 * (lvl + 1) }, children: [new TextRun(li.attrs.checked ? '☑ ' : '☐ '), ...runs(ch.content, li.attrs.checked ? { color: '8A8077' } : {})] }));
            else await walk([ch], { ...ctx, level: lvl + 1 });
          } break; }
        case 'blockquote': await walk(c, { ...ctx, para: { style: 'Quote' } }); break;
        case 'callout': {
          const first = { ...ctx, para: { style: 'Callout' } }; const kids = c || [];
          if (kids[0] && kids[0].type === 'paragraph') { body.push(new Paragraph({ style: 'Callout', children: [new TextRun((n.attrs.emoji || '💡') + ' '), ...runs(kids[0].content)] })); await walk(kids.slice(1), first); }
          else await walk(kids, first); break; }
        case 'codeBlock': {
          const lines = (c || []).map(t => t.text).join('').split('\n');
          lines.forEach(l => body.push(new Paragraph({ style: 'Code', children: [new TextRun({ text: l || ' ', font: MONO })] }))); break; }
        case 'horizontalRule': body.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '· · ·', color: 'B5AA9C' })] })); break;
        case 'image': try { const im = await imgInfo(n.attrs.src); body.push(new Paragraph({ children: [new ImageRun({ type: im.type, data: im.bytes, transformation: { width: im.w, height: im.h }, altText: { name: n.attrs.alt || 'image', description: n.attrs.alt || '', title: n.attrs.title || '' } })] })); } catch { body.push(new Paragraph({ children: [new TextRun({ text: `[이미지: ${n.attrs.src.slice(0, 60)}]`, italics: true })] })); } break;
        case 'details': {
          const s = (c || []).find(x => x.type === 'detailsSummary'), ct = (c || []).find(x => x.type === 'detailsContent');
          body.push(new Paragraph({ style: 'Toggle', children: [new TextRun({ text: '▸ ', bold: true }), ...runs(s && s.content, { bold: true })] }));
          await walk(ct && ct.content, { ...ctx, para: { indent: { left: 360 } } }); break; }
        case 'table': {
          const rows = (c || []).map(r => new TableRow({ tableHeader: (r.content || []).every(x => x.type === 'tableHeader') || undefined, children: (r.content || []).map(cell => new TableCell({ shading: cell.type === 'tableHeader' ? { type: ShadingType.CLEAR, fill: 'F3EDE3', color: 'auto' } : undefined, children: (cell.content || []).map(p => new Paragraph({ children: runs(p.content, cell.type === 'tableHeader' ? { bold: true } : {}) })).concat((cell.content || []).length ? [] : [new Paragraph('')]) })) }));
          if (rows.length) body.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
          body.push(new Paragraph('')); break; }
        default: if (c) await walk(c, ctx);
      }
    }
  };
  await walk(page.content.content);
  const lv = (fmt, txt) => [0, 1, 2, 3, 4, 5].map(l => ({ level: l, format: fmt, text: typeof txt === 'function' ? txt(l) : txt, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } } }));
  const doc = new Document({
    creator: 'Lite Notes', title: page.title || '제목 없음',
    styles: {
      default: { document: { run: { font: 'Apple SD Gothic Neo', size: 22 } } },
      characterStyles: [{ id: 'CodeChar', name: 'Code Char', run: { font: MONO, color: 'B4547A' } }],
      paragraphStyles: [
        { id: 'Code', name: 'Code', basedOn: 'Normal', run: { font: MONO, size: 19 }, paragraph: { spacing: { before: 0, after: 0 }, shading: { type: ShadingType.CLEAR, fill: 'F3EDE3', color: 'auto' } } },
        { id: 'Quote', name: 'Quote', basedOn: 'Normal', run: { color: '5B524A' }, paragraph: { indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'D9CFF3', space: 8 } } } },
        { id: 'Callout', name: 'Callout', basedOn: 'Normal', paragraph: { shading: { type: ShadingType.CLEAR, fill: 'FBF3D5', color: 'auto' }, indent: { left: 120, right: 120 } } },
        { id: 'Toggle', name: 'Toggle', basedOn: 'Normal' },
      ],
    },
    numbering: { config: [{ reference: 'bullets', levels: lv(LevelFormat.BULLET, l => ['•', '◦', '▪'][l % 3]) }, { reference: 'numbers', levels: lv(LevelFormat.DECIMAL, l => `%${l + 1}.`) }] },
    sections: [{ children: [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun((page.icon ? page.icon + ' ' : '') + (page.title || '제목 없음'))] }), ...body] }],
  });
  return Packer.toBlob(doc);
}
