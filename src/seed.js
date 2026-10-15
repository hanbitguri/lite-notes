import { generateJSON } from '@tiptap/core';
import { baseExtensions } from './extensions.js';
import { newPage } from './store.js';
const doc = html => generateJSON(html, baseExtensions());
export async function seedPages() {
  const welcome = newPage({ title: '라이트 노트에 오신 걸 환영해요', icon: '🧸', cover: 'lav', order: 0 });
  const guide = newPage({ title: '가져오기 · 내보내기', icon: '🗂️', parentId: welcome.id, order: 1 });
  const trip = newPage({ title: '여행 준비 체크리스트', icon: '✈️', order: 1 });
  welcome.content = doc(`
<p>가볍게 쓰는 문서 노트예요. 모든 내용은 <b>이 기기 안에 자동 저장</b>되고, 인터넷이 없어도 열려요.</p>
<div data-callout data-emoji="💡"><p>빈 줄에서 <code>/</code> 를 누르면 블록 메뉴가 떠요. <code>#</code> <code>-</code> <code>[]</code> <code>&gt;</code> <code>\`\`\`</code> 같은 마크다운도 바로 바뀌어요.</p></div>
<h2>이런 블록을 쓸 수 있어요</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>할 일 체크하기</p></li><li data-type="taskItem" data-checked="false"><p>왼쪽 ⠿ 손잡이로 블록 순서 바꾸기</p></li></ul>
<ul><li><p>글머리 목록</p><ul><li><p>Tab 으로 들여쓰기</p></li></ul></li></ul>
<ol><li><p>번호 목록</p></li><li><p>자동으로 번호가 붙어요</p></li></ol>
<details class="toggle"><summary>토글을 눌러 보세요</summary><div data-type="detailsContent"><p>접혀 있던 내용이에요 ✨</p></div></details>
<blockquote><p>인용문은 이렇게 보여요.</p></blockquote>
<pre><code class="language-javascript">// 코드 블록은 문법 강조가 돼요
const hello = (name) =&gt; \`안녕, \${name}!\`;
console.log(hello('한빛'));</code></pre>
<table><tbody><tr><th><p>기능</p></th><th><p>단축키</p></th></tr><tr><td><p>검색</p></td><td><p>⌘ K</p></td></tr><tr><td><p>새 페이지</p></td><td><p>⌘ ⇧ P</p></td></tr></tbody></table>
<hr>
<p>하위 페이지: <a href="#/p/${guide.id}">🗂️ 가져오기 · 내보내기</a></p>`);
  guide.content = doc(`
<h2>가져오기</h2>
<ul><li><p><b>Notion 내보내기 zip</b> (Markdown &amp; CSV, HTML 둘 다) — 폴더 구조로 페이지 트리를 다시 만들고, 페이지 ID 꼬리표를 떼고, 페이지 간 링크와 이미지를 다시 이어요. 데이터베이스(CSV)는 표 페이지가 돼요.</p></li><li><p>Markdown · HTML · Word(.docx) · CSV · 백업 JSON</p></li></ul>
<h2>내보내기</h2>
<ul><li><p>페이지: Markdown (이미지는 images 폴더와 zip), HTML 한 파일, PDF, Word</p></li><li><p>전체: Markdown zip, HTML zip, 백업 JSON</p></li></ul>
<div data-callout data-emoji="🔒"><p>지금은 이 기기에만 저장돼요. 기기를 바꾸기 전에는 <b>백업(JSON)</b> 으로 내보내 두세요.</p></div>`);
  trip.content = doc(`<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>여권 챙기기</p></li><li data-type="taskItem" data-checked="false"><p>숙소 예약 확인</p></li><li data-type="taskItem" data-checked="true"><p>항공권 예매</p></li></ul>`);
  [welcome, guide, trip].forEach(p => p.text = JSON.stringify(p.content).replace(/"[a-zA-Z]+":|[{}\[\]",]/g, ' ').replace(/\b(type|text|attrs|content|paragraph|marks)\b/g, '').replace(/\s+/g, ' ').slice(0, 5000));
  return [welcome, guide, trip];
}
