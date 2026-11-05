# PDF selection translation implementation plan

**Approved design:** Keep the PDF.js reader. Preserve native selection, show a small translate/copy toolbar, display short vocabulary explanations in a popover and passage translations in a side panel. Translation never saves annotations automatically; saving short vocabulary is explicit. Long passages need no highlight rectangles.

**Architecture:** A separate streaming translation route emits newline-delimited JSON (`delta`, `done`, `error`). A client request controller cancels superseded work and caches only complete results. Selection extraction and UI are separate from persistent vocabulary. Existing PDF identity checks remain on vocabulary writes.

**Tech stack:** Next.js 16 App Router, React 19, PDF.js 4.10.38, node:test, browser validation using Chromium if available.

## Tasks

- [x] Add regression tests for passages above 160 characters, PDF line-break cleanup, short-word versus passage classification, stream chunk boundaries, upstream errors and cancellation. Run targeted node:test commands to establish failures before implementation.
- [x] Implement `/api/reader/translate` with 12,000-character validation, bounded context, existing server-side DeepSeek configuration, streaming deltas, terminal success/error, abort propagation and no vocabulary writes. Add explicit `save` to `/api/vocabulary`, retaining document identity and rectangle validation.
- [x] Implement `reader-selection.ts` and a cancellable client request controller; cache keys include document, selected text and context. Never cache truncated or failed streams. New selection, close, document change and unmount invalidate obsolete work.
- [x] Update `full-pdf-page.tsx` to preserve native selection and collect selection at reader level (including cross-page selection). Keep point lookup optional; allow dragging even in lookup mode. Draw saved highlights beneath the text hit targets, with coordinate hit testing for existing word hints. Prevent mouseup outside the page from losing selections.
- [x] Add `reader-translation.tsx` for the compact toolbar, short explanation popover and passage side panel. Keep panel content during PDF scrolling; close transient anchors on viewport changes. Permit copying translated content, retry, Escape and explicit short-word saving.
- [x] Integrate the reader and CSS, retain existing vocabulary and terms, remove obsolete translation-and-save UI. Avoid re-rendering text layers while streaming or opening the translation panel.
- [x] Run `npm run check`, production build, and browser cases for real PDF drag selections, long passages, saved-highlight traversal, zoom/scroll, delayed old responses, and failed/retried streams. Record limitations honestly.

## Acceptance examples

```js
assert.equal(classifySelection('point cloud'), 'word');
assert.equal(classifySelection('This is a complete sentence.'), 'passage');
assert.equal(normalizeSelectionText('reconstruc-\ntion of\nmodels'), 'reconstruction of models');
// A passage request without `rects` streams text and leaves vocabulary.json unchanged.
// If request A finishes after request B starts, only B may update the visible result.
```

## References

- https://github.com/windingwind/zotero-pdf-translate (translation independent of annotations)
- https://github.com/mozilla/pdf.js/blob/v4.10.38/web/text_layer_builder.js (native text selection lifecycle)
- https://github.com/fishjar/kiss-translator (streaming selection UI)

The implementation follows these interaction ideas; it does not copy third-party application source.

## Verification — 2026-10-23

- `npm run check`: typecheck, ESLint and all 97 node tests passed.
- `npm run build`: successful production build. Five dynamic-filesystem tracing warnings remain in unchanged code-reader/platform/project files.
- `tests/browser/reader-selection.mjs`: passed in actual headless Microsoft Edge with the bundled real PDF. All application APIs are intercepted; no real model calls or user-library writes occur.
- Browser coverage: native long/multiline dragging, cross-page Range selection, transparent selected text, copy, no automatic annotations, explicit vocabulary save, dragging through saved annotations, context for repeated words, zoom/pan coordinates and hover, point lookup plus dragging, incomplete-stream retry, cache reuse, superseded-response isolation, immediate-scroll debounce race, and a 390×844 viewport.
- Screenshots inspected: `.build-cache/reader-verification/passage.png`, `word.png`, `mobile.png`.
- Independent review found geometry, context and lifecycle issues; fixes were reviewed again with no remaining blockers. Zoom/pan and immediate-scroll failures were reproduced before fixes and passed afterward.
- Live provider latency and translation quality are not measured by these mocked tests. Scanned PDFs still require a text layer/OCR before native selection is possible.

To rerun browser checks, start the app on a local port, install Playwright in your test environment, and run `node tests/browser/reader-selection.mjs`. Set `READER_TEST_URL` if the server is not on port 3111; set `PLAYWRIGHT_MODULE` to an absolute Playwright entry path if it is not locally installed. `READER_TEST_BROWSER` defaults to `msedge` and can be set to `chrome`.
