# word2

An experiment: a word processor rebuilt around one idea — **the document is code**, and the AI edits that code the way a good colleague edits a draft: as reviewable, attributable, individually acceptable changes.

```bash
pnpm install
pnpm dev        # http://localhost:5273  (pure static app, no server)
pnpm test       # SDK, editor-schema and agent tests
pnpm build      # static bundle in apps/web/dist
```

Paste an Anthropic API key in the Claude panel (kept in localStorage, sent only to api.anthropic.com).

### Drive and live collaboration

Documents in [Drive](../drive) (drive.nyggis.com) open here as `/?file=<id>`. The source syncs live through the drive's room (`@alexandernygard/collab`, one Y.Text), so several people can edit at once, and sharing follows Drive: people you add by email, as viewers or editors, with Nyggis accounts. A Drive document isn't kept in the browser; the local document stays as it was. A new tab starts on an empty document, and a reload keeps what that tab had (sessionStorage), so documents to keep belong in Drive. *Save to Drive* in the top bar copies the local document there and reopens it from Drive. Each view keeps its own undo history, and edits from others don't go on it. Locally, run the drive (`pnpm dev:worker` in `../drive`) and the auth Worker (:8787).
## Packages

| Package | What it is |
| --- | --- |
| `packages/sdk` — `@word2/sdk` | The document model and everything you can do to it, with no DOM: types, parser, serializer, builders, structural ops (outline, move/promote sections), tracked suggestions (diff → suggestions, accept/reject), comments, footnotes, citations & bibliography, themes, page setup, pagination math, and `.docx` export. |
| `packages/react` — `@word2/react` | Rendering: `<DocumentView>` (read-only, real pages or web mode — used for preview and PDF) and `<DocumentEditor>` (TipTap/ProseMirror WYSIWYG drawn as real pages), charts via the component library's `Chart` (recharts). |
| `apps/web` | The app: editor + code view side by side, outline, Claude panel, review panel, page setup, export. zustand store, CodeMirror 6, `@alexandernygard/components`. |

## The format: markdown, extended (`.w2.md`)

```markdown
---
title: Q3 Market Review
theme: report                      # classic | modern | report | academic
page: { size: A4, margins: { top: 22 } }
header: "{{title}} | | {{section}}"   # left | center | right
footer: " | Page {{page}} of {{pages}} | "
numberedHeadings: true
references: [{ id: hartley2025, author: M. Hartley, title: Subscription Retail, year: 2025 }]
ai: { audience: Executive team, tone: Direct }   # standing brief Claude always reads
---

::toc

# Summary {#summary}

Revenue grew **18%**,^[Unaudited.] see [@hartley2025, p. 4]. [Underlined]{.underline}

We {~~think~>recommend~~}{>>@claude: a summary should commit<<} expanding.   ← tracked change + reason
{==this claim==}{>>@alex: source?<<}{>>@claude: added one<<}                  ← comment thread

| Channel | Q3 |              ```chart                  :::warning[Heads up]
| ------- | -: |              type: bar                  Callout body.
| Cafés   | 1,490 |           x: channel                 :::
Table: Revenue                y: Q3 2025, Q3 2026
                              ---                        :::columns{count=2}
::pagebreak                   channel,Q3 2025,Q3 2026    …
::references                  Cafés,1570,1490            :::
                              ```
```

**Why markdown and not JSX or a JSON tree** (this was the main design question):

- **JSX/MDX** is great for *generating* documents (loops, components, data), but it can't round-trip: once a paragraph is `{data.map(...)}`, a WYSIWYG edit has nowhere to go. You'd need a "static JSX subset", at which point it's just a verbose markup language. LLMs also burn more tokens and make more syntax errors in JSX than in markdown.
- **A JSON tree** round-trips perfectly but nobody can read, diff or review it, and it's 3–5× the tokens for the model.
- **Markdown + a few well-known extensions** (Pandoc spans/footnotes/citations, remark-style `:::` directives, CriticMarkup for review) is readable, diffable in git, the format LLMs write best, and unambiguous enough to parse into a typed tree. The **tree is the in-memory source of truth**; the text is its serialization. Programmatic generation still exists — via the SDK builders (`build.doc(h1(...), p(...), table(...))`) instead of inside the file.

Suggestions and comments live **in the document itself** (CriticMarkup), so they survive copy/paste, git, export and reloads, and the code view shows exactly what is pending.

## How the round trip works

```
         setSource(text)                      setBlocks(blocks)
code view ───────────────▶  parse ─▶ Document ◀──────────────── editor (ProseMirror)
    ▲      minimal text change        │   ▲      minimal PM diff        │
    └──────── serialize ◀─────────────┘   └──────── toPM ───────────────┘
                (unchanged blocks reuse their original text)
```

- **Block ids.** Every block gets an id at parse time; ids are carried across re-parses (`reconcileIds`: unchanged blocks keep their object, edited blocks keep their id by position) and stored as a `bid` attribute in ProseMirror. The editor, code view, outline, review panel and the AI all address the same blocks.
- **Keeping the code readable.** The serializer is canonical, but `serialize(doc, cache)` reuses the *exact original text* of every block whose content didn't change. A WYSIWYG edit rewrites only the edited block; your own formatting elsewhere (line wraps, spacing, YAML style) survives.
- **Cursor stability.** Changes from the other side are applied as the smallest possible edit: in ProseMirror via `findDiffStart/findDiffEnd` + one `replace` step (the selection maps through it), in CodeMirror via a common-prefix/suffix text change. Each change carries an `origin` so a view never re-applies its own edit. Tested in the browser: deleting text before the editor caret from the code side leaves the caret on the same word.
- **Linked cursors.** The block under the caret in one view is highlighted (and scrolled to) in the other.
- **Undo.** Each surface has its own history; changes from AI/review actions go onto the editor's undo stack, code edits don't. Every Claude turn also records a checkpoint ("Undo this turn").

### Editor framework: ProseMirror (via TipTap) — yes

Evaluated ProseMirror/TipTap, Lexical, Slate and a hand-rolled contenteditable. ProseMirror won because the round-trip needs exactly its strengths: a strict schema (so the model ⇄ editor mapping is total), document diffing (`findDiffStart`) and position mapping through steps (cursor stability), decorations (for page chrome), and node views (charts, TOC, footnotes as React). TipTap adds tables, lists, React node views and keyboard behaviour for free. Lexical's model doesn't expose diff/mapping primitives as cleanly; Slate is less robust with IME and large docs.

### Pagination

One continuous contenteditable, drawn as pages: after each update the pagination plugin measures every top-level block, runs the shared `paginate()` (keep-with-next for headings, explicit page breaks, page footnotes), and inserts non-editable widget decorations that draw the rest of the page, that page's footnotes, the footer, the gap and the next header. Selection, typing and undo work across pages; the read-only `<DocumentView>` uses the same layout function and prints 1:1 via `@page`.

## AI-first, concretely

Not a chatbot next to a text box — Claude works *on the document*:

- **Structured edits, human review.** Claude rewrites blocks by id (`edit_blocks`); the SDK turns each rewrite into word-level tracked changes with Claude's *reason* attached. You accept/reject each change (popover in the page, or the Review panel), or all at once. Toggle "Suggest edits" off to let it edit directly.
- **Drafting streams into the pages.** `write_document` streams via eager tool-input streaming; partial source is parsed every 150 ms so you watch pages fill.
- **Selection-scoped actions:** improve, tighten, expand, fix grammar, change tone, summarize, continue, make a table, chart from data, plus `/` → "Ask Claude to write…".
- **Comments are a conversation.** Mention `@claude` in a comment and "Address @claude comments": it edits, replies in the thread and resolves it. It can also leave its own comments for questions only you can answer.
- **The brief lives in the document** (`ai:` front matter: audience, tone, purpose), so every request is grounded without repeating yourself.
- **Settings are content too:** theme, page size, header/footer, numbering, references are front matter the model can change (`update_settings`).

Model: `claude-opus-5-5` by default (switchable), adaptive thinking (summaries shown as "reasoning"), effort `medium` for chat and `low` for quick actions, prompt-cached system prompt, and **server-side refusal fallbacks enabled** (`fallbacks: "default"`).

## Limitations and what would need new tech

| Area | Today | What it would take |
| --- | --- | --- |
| **Pagination** | Breaks between top-level blocks. A paragraph or table that doesn't fit moves whole to the next page; one taller than a page overflows. Widow/orphan control only for headings. | Line-level splitting needs a layout engine that owns line breaking: either render pages from a measured line model (what Google Docs did by moving to canvas), or the CSS Fragmentation/Regions model inside contenteditable (not supported by browsers). A pragmatic next step: split tables by rows and long paragraphs by measured line boxes into "continuation" fragments in the view layer only. |
| **Sections** | One page setup per document (plus in-page column regions). | Per-section orientation/margins/headers = multiple page "streams"; the plugin would need section boundaries as first-class nodes. |
| **Print/PDF fidelity** | Browser print of the read-only renderer; fonts from Google Fonts. | Exact cross-machine output needs a deterministic engine (e.g. Paged.js, or typesetting with something like Typst/WASM) instead of the browser. |
| **DOCX** | Export works and is real Word: suggestions → tracked changes, comments with replies, native footnotes, editable native charts, TOC field, headers/footers with page fields. No import. | Import = mapping Word's style/run soup back to semantic blocks (lossy; mammoth-style). |
| **Your own tracked changes** | "Track changes" (format bar, or Claude panel settings with your author name) turns your typing, pasting and deleting into `insertion`/`deletion` marks. A ProseMirror plugin (`packages/react/src/editor/track-changes.ts`) inverts each user transaction and replays it as tracked edits. Deleting your own pending insertion really removes it, and Backspace over struck text just moves the cursor. Adjacent edits by the same author share one suggestion, and IME text is marked when composition ends. Only text is tracked: Enter, joining paragraphs, deleting images and formatting apply directly. **Version history** (History tab) keeps named snapshots of the source: autosaved every 5 minutes when changed, before every Claude turn, and on "Save version". Each one shows a block-level diff against now and can be restored. | Tracking paragraph splits/joins and formatting changes (Word's "formatting" revisions) needs block-level and attribute-level suggestions in the model. Versions live in localStorage, so they're capped at 60 and bounded by its quota. |
| **Collaboration** | Single user, localStorage. | Yjs + `y-prosemirror` on the editor side, with the source text derived (not edited) during collaborative sessions — or a CRDT over the text plus re-parse. The block-id design already makes per-block presence/locking easy. Needs a relay server (or WebRTC) — the first thing that breaks "no server". |
| **Code-view edge cases** | Re-parse is lenient; malformed markup degrades to paragraphs and shows warnings. Empty paragraphs don't survive a code-side re-parse. Inline mark nesting that markdown can't express falls back to `[text]{.bold}` spans. | Fine for a prototype; a real product wants a Lezer grammar for the format (proper code highlighting + incremental parse). |
| **Images** | URL only, no upload/drag-drop (no storage). | IndexedDB or an asset store. |
| **AI** | Context = whole document each changed turn; fine to a few hundred pages with 1M context and caching, but costly. No retrieval. | Block-level summaries + only-sending-what-changed; MCP connectors for sources/citations. |

## Testing

- `packages/sdk/test` — parse/serialize round trip of a fixture covering every feature, inline edge cases (ambiguous delimiters, escapes), source-text reuse, id stability, suggestion diffing/accept/reject, comments, section moves, pagination, DOCX output (asserts `<w:ins>`, `<w:del>`, comments, footnotes, chart parts).
- `packages/react/test` — every block of the fixture fits the editor schema and survives model → ProseMirror → model.
- `apps/web/test` — the agent loop against a scripted client: block rewrites become attributed suggestions, tool results flow back, streamed drafting renders live, bad ids produce recoverable errors.
- `apps/web/scripts/smoke.ts` — the same loop against the real API: `ANTHROPIC_API_KEY=… pnpm --filter @word2/web exec tsx scripts/smoke.ts "Tighten the summary"`.
