import type { Editor } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import { TextSelection } from "@tiptap/pm/state"
import { EditorContent, useEditor } from "@tiptap/react"
import { contentKey, themeVars, type Block, type Document } from "@word2/sdk"
import { useEffect, useMemo, useRef, type CSSProperties } from "react"
import { pageGeometry } from "../shared/geometry"
import { EditorBridge, type LayoutMode, type PageLayout, type ReviewTarget } from "./bridge"
import { docFromPM, docToPM } from "./convert"
import { createExtensions, setActiveBlock } from "./extensions"

export type SelectionInfo = {
  /** top-level blocks touched by the selection */
  blockIds: string[]
  text: string
  empty: boolean
  /** block containing the cursor head */
  headBlockId: string | null
}

export type DocumentEditorProps = {
  doc: Document
  /** called with the new top-level blocks after a user edit in the editor */
  onChange: (blocks: Block[]) => void
  mode?: LayoutMode
  /** block highlighted from elsewhere (e.g. the code view's cursor) */
  activeBlockId?: string | null
  /** scroll the active block into view when it changes */
  followActive?: boolean
  /** whether a doc change coming in through props goes onto the editor's undo stack */
  undoableSync?: boolean
  editable?: boolean
  onSelectionChange?: (s: SelectionInfo) => void
  onReady?: (editor: Editor, api: EditorApi) => void
  onReview?: (t: ReviewTarget) => void
  onLayout?: (l: PageLayout) => void
  className?: string
}

export type EditorApi = { bridge: EditorBridge; scrollToBlock: (bid: string, select?: boolean) => void }

/**
 * Replace only the changed range of the document. ProseMirror maps the selection
 * through the step, so the cursor stays where it was when edits arrive from the
 * code view or the AI.
 */
export function applyMinimalDiff(editor: Editor, next: PMNode, addToHistory: boolean): boolean {
  const { state } = editor.view
  const a = state.doc
  const start = a.content.findDiffStart(next.content)
  if (start == null) return false
  const end = a.content.findDiffEnd(next.content)!
  let endA = end.a
  let endB = end.b
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  const tr = state.tr.replace(start, endA, next.slice(start, endB)).setMeta("w2-sync", true)
  if (!addToHistory) tr.setMeta("addToHistory", false)
  editor.view.dispatch(tr)
  return true
}

function selectionInfo(editor: Editor): SelectionInfo {
  const { state } = editor
  const { from, to, empty, head } = state.selection
  const blockIds: string[] = []
  let headBlockId: string | null = null
  state.doc.forEach((node, pos) => {
    const end = pos + node.nodeSize
    if (end >= from && pos <= to && node.attrs.bid) blockIds.push(node.attrs.bid)
    if (head >= pos && head <= end && node.attrs.bid) headBlockId = node.attrs.bid
  })
  return { blockIds, text: state.doc.textBetween(from, to, "\n"), empty, headBlockId }
}

export function DocumentEditor({
  doc,
  onChange,
  mode = "print",
  activeBlockId = null,
  followActive = false,
  undoableSync = true,
  editable = true,
  onSelectionChange,
  onReady,
  onReview,
  onLayout,
  className,
}: DocumentEditorProps) {
  const bridge = useMemo(() => new EditorBridge(), [])
  const lastEmitted = useRef<Block[] | null>(null)
  const cb = useRef({ onChange, onSelectionChange, onReview, onLayout })
  cb.current = { onChange, onSelectionChange, onReview, onLayout }

  // keep the bridge current before the first render of node views
  if (bridge.doc !== doc || bridge.mode !== mode) {
    bridge.doc = doc
    bridge.mode = mode
  }

  const editor = useEditor({
    extensions: createExtensions(bridge),
    content: docToPM(doc.blocks),
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor, transaction }) => {
      if (transaction.getMeta("w2-sync")) return
      const blocks = docFromPM(editor.getJSON() as never)
      lastEmitted.current = blocks
      cb.current.onChange(blocks)
    },
    onCreate: ({ editor }) => {
      // start with a text cursor, not a node selection on a leading TOC/chart
      const sel = TextSelection.findFrom(editor.state.doc.resolve(0), 1, true)
      if (sel) editor.view.dispatch(editor.state.tr.setSelection(sel).setMeta("addToHistory", false))
    },
    onSelectionUpdate: ({ editor }) => cb.current.onSelectionChange?.(selectionInfo(editor)),
  })

  const api = useMemo<EditorApi>(
    () => ({
      bridge,
      scrollToBlock: (bid, select = true) => {
        if (!editor) return
        const { view } = editor
        view.state.doc.forEach((node, pos) => {
          if (node.attrs.bid !== bid) return
          const dom = view.nodeDOM(pos) as HTMLElement | null
          dom?.scrollIntoView({ block: "start", behavior: "smooth" })
          if (select) {
            const inside = Math.min(pos + 1, view.state.doc.content.size)
            view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(inside))))
            view.focus()
          }
        })
      },
    }),
    [bridge, editor],
  )
  bridge.scrollToBlock = (bid) => api.scrollToBlock(bid)

  useEffect(() => {
    if (editor) onReady?.(editor, api)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  useEffect(() => bridge.on("review", (t) => cb.current.onReview?.(t)), [bridge])
  useEffect(() => bridge.on("layout", (l) => cb.current.onLayout?.(l)), [bridge])

  // incoming document changes (code view, AI, review actions)
  useEffect(() => {
    if (!editor) return
    bridge.update({ doc, mode })
    if (doc.blocks === lastEmitted.current) return
    lastEmitted.current = doc.blocks
    const next = editor.schema.nodeFromJSON(docToPM(doc.blocks))
    // dispatch outside React's commit phase: node views re-render synchronously
    queueMicrotask(() => !editor.isDestroyed && applyMinimalDiff(editor, next, undoableSync))
  }, [doc, editor, bridge, mode, undoableSync])

  // page setup / header / footer / mode changes need a re-layout
  const layoutKey = contentKey({ m: doc.meta.page, h: doc.meta.header, f: doc.meta.footer, t: doc.meta.theme, s: doc.meta.styles, mode })
  useEffect(() => {
    bridge.emit("config", null)
  }, [layoutKey, bridge])

  useEffect(() => {
    if (!editor) return
    queueMicrotask(() => !editor.isDestroyed && setActiveBlock(editor.view as never, activeBlockId))
    if (followActive && activeBlockId) {
      editor.state.doc.forEach((node, pos) => {
        if (node.attrs.bid !== activeBlockId) return
        const dom = editor.view.nodeDOM(pos) as HTMLElement | null
        if (!dom) return
        const r = dom.getBoundingClientRect()
        if (r.top < 80 || r.bottom > window.innerHeight - 40) dom.scrollIntoView({ block: "center", behavior: "smooth" })
      })
    }
  }, [activeBlockId, editor, followActive])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  const g = pageGeometry(doc.meta)
  const style = {
    ...themeVars(doc.meta),
    "--w2-page-w": `${g.width}px`,
    "--w2-page-h": `${g.height}px`,
    "--w2-mt": `${g.top}px`,
    "--w2-mr": `${g.right}px`,
    "--w2-mb": `${g.bottom}px`,
    "--w2-ml": `${g.left}px`,
    "--w2-content-w": `${g.contentWidth}px`,
  } as CSSProperties

  return (
    <div className={`w2-doc w2-editor ${mode === "print" ? "w2-print" : "w2-web"} ${doc.meta.numberedHeadings ? "w2-numbered" : ""} ${className ?? ""}`} style={style}>
      <EditorContent editor={editor} />
    </div>
  )
}
