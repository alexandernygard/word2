import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { Annotation, EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state"
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view"
import { tags as t } from "@lezer/highlight"
import { useEffect, useRef } from "react"
import { textChange, useStore } from "../store"

/** Marks transactions that came from the store (so we don't echo them back). */
const Remote = Annotation.define<boolean>()

const setLinked = StateEffect.define<{ from: number; to: number } | null>()
const linkedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setLinked)) continue
      if (!e.value) return Decoration.none
      const b = new RangeSetBuilder<Decoration>()
      const { from, to } = e.value
      const doc = tr.state.doc
      if (from > doc.length) return Decoration.none
      for (let l = doc.lineAt(from).number; l <= doc.lineAt(Math.min(to, doc.length)).number; l++) {
        b.add(doc.line(l).from, doc.line(l).from, Decoration.line({ class: "cm-w2-linked" }))
      }
      deco = b.finish()
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

function matcher(regexp: RegExp, cls: string) {
  const m = new MatchDecorator({ regexp, decoration: Decoration.mark({ class: cls }) })
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = m.createDeco(view)
      }
      update(u: ViewUpdate) {
        this.decorations = m.updateDeco(u, this.decorations)
      }
    },
    { decorations: (v) => v.decorations },
  )
}

const review = [
  matcher(/\{\+\+[\s\S]*?\+\+\}/g, "cm-w2-ins"),
  matcher(/\{--[\s\S]*?--\}/g, "cm-w2-del"),
  matcher(/\{~~[\s\S]*?~~\}/g, "cm-w2-sub"),
  matcher(/\{==[\s\S]*?==\}/g, "cm-w2-hl"),
  matcher(/\{>>[\s\S]*?<<\}/g, "cm-w2-comment"),
  matcher(/^:{2,}.*$/gm, "cm-w2-directive"),
  matcher(/\^\[[^\]]*\]|\[@[^\]]+\]|\[\^[^\]]+\]/g, "cm-w2-ref"),
]

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.15em", color: "var(--cm-heading)" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.07em", color: "var(--cm-heading)" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700", color: "var(--cm-heading)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--cm-link)" },
  { tag: t.monospace, color: "var(--cm-code)" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--cm-muted)" },
  { tag: t.quote, color: "var(--cm-muted)", fontStyle: "italic" },
  { tag: t.list, color: "var(--cm-link)" },
])

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "'JetBrains Mono', ui-monospace, monospace", lineHeight: "1.65" },
  ".cm-content": { padding: "16px 0 120px", caretColor: "var(--highlight)" },
  ".cm-line": { padding: "0 18px 0 10px" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--cm-gutter)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--foreground) 4%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "color-mix(in oklab, var(--highlight) 28%, transparent) !important" },
  ".cm-cursor": { borderLeftColor: "var(--highlight)", borderLeftWidth: "2px" },
})

/** Which top-level block contains a source offset. */
function blockAt(offset: number): string | null {
  const { sources } = useStore.getState()
  for (const s of sources) if (offset >= s.from && offset <= s.to) return s.id
  // between blocks: pick the next one
  return sources.find((s) => s.from > offset)?.id ?? sources[sources.length - 1]?.id ?? null
}

export function CodeView() {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: useStore.getState().source,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          markdown(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          theme,
          linkedField,
          review,
          EditorView.updateListener.of((u) => {
            const remote = u.transactions.some((tr) => tr.annotation(Remote))
            if (u.docChanged && !remote) useStore.getState().setSource(u.state.doc.toString())
            if (u.selectionSet && !remote && u.view.hasFocus) {
              const id = blockAt(u.state.selection.main.head)
              useStore.getState().setActive(id, "code")
            }
          }),
          EditorView.domEventHandlers({
            focus: (_e, v) => {
              useStore.getState().setActive(blockAt(v.state.selection.main.head), "code")
            },
          }),
        ],
      }),
    })
    viewRef.current = view
    ;(window as unknown as { __w2cm: EditorView }).__w2cm = view

    const unsub = useStore.subscribe((s, p) => {
      // document changed elsewhere → apply the minimal text change (CodeMirror maps our cursor through it)
      if (s.source !== p.source && s.origin !== "code") {
        const change = textChange(view.state.doc.toString(), s.source)
        if (change) view.dispatch({ changes: change, annotations: [Remote.of(true)] })
      }
      // cursor in the document view → highlight the block's source
      if (s.activeBlockId !== p.activeBlockId || s.activeFrom !== p.activeFrom || (s.sources !== p.sources && s.activeFrom === "editor")) {
        const src = s.activeFrom === "editor" ? s.sources.find((x) => x.id === s.activeBlockId) : null
        const effects: StateEffect<unknown>[] = [setLinked.of(src ? { from: src.from, to: src.to } : null)]
        if (src && !view.hasFocus && s.activeBlockId !== p.activeBlockId) effects.push(EditorView.scrollIntoView(Math.min(src.from, view.state.doc.length), { y: "center" }))
        view.dispatch({ effects, annotations: [Remote.of(true)] })
      }
    })
    return () => {
      unsub()
      view.destroy()
    }
  }, [])

  return <div ref={host} className="w2-code-view h-full overflow-hidden" />
}
