# 라이트 노트 (Lite Notes)
가볍게 쓰는 문서 노트. Tiptap(ProseMirror) 블록 에디터, IndexedDB 자동 저장, PWA.
가져오기: Notion 내보내기 zip(Markdown & CSV / HTML, zip-in-zip), Markdown, HTML, DOCX, CSV, 백업 JSON.
내보내기: Markdown(+images zip), HTML, PDF(인쇄), DOCX, 전체 Markdown/HTML zip, 백업 JSON.
빌드: `npm i && ./build.sh` → `dist/`. 테스트: `test/fidelity.py`, `test/ui.py` (Playwright).
저장소 계층은 `src/store.js` 어댑터로 분리되어 있어 나중에 Supabase 어댑터로 교체 가능.
