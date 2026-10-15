import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { createLowlight, common } from 'lowlight';

export const lowlight = createLowlight(common);

export const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  addAttributes() {
    return {
      emoji: { default: '💡', parseHTML: el => el.getAttribute('data-emoji') || '💡', renderHTML: a => ({ 'data-emoji': a.emoji }) },
      color: { default: 'butter', parseHTML: el => el.getAttribute('data-color') || 'butter', renderHTML: a => ({ 'data-color': a.color }) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-callout]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'callout' }), 0]; },
  addCommands() {
    return {
      setCallout: (attrs = {}) => ({ commands }) => commands.wrapIn(this.name, attrs),
      toggleCallout: (attrs = {}) => ({ commands }) => commands.toggleWrap(this.name, attrs),
    };
  },
});

// shared schema used by the editor AND by import/export (generateHTML / generateJSON)
export function baseExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener', target: null } },
      dropcursor: { color: '#B9A6EE', width: 3 },
      heading: { levels: [1, 2, 3] },
    }),
    TaskList, TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Image.configure({ allowBase64: true, inline: false }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'toggle' } }), DetailsSummary, DetailsContent,
    Callout,
  ];
}
