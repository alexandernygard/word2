import { Extension, Mark, Node, mergeAttributes, type AnyExtension } from "@tiptap/core"
import { Highlight } from "@tiptap/extension-highlight"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { Subscript } from "@tiptap/extension-subscript"
import { Superscript } from "@tiptap/extension-superscript"
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table"
import { TextAlign } from "@tiptap/extension-text-align"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { Placeholder } from "@tiptap/extensions"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import { newId } from "@word2/sdk"
import type { EditorBridge } from "./bridge"
import { ChartView, CiteView, FootnoteView, ImageView, ReferencesView, TocView } from "./nodeviews"
import { Pagination } from "./pagination"
import { TrackChanges } from "./track-changes"

export const TOP_LEVEL = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "callout",
  "columns",
  "suggestionBlock",
  "image",
  "chart",
  "toc",
  "pageBreak",
  "references",
]

/** Block ids (`bid`) on every block type + keeps them unique when nodes are split/pasted. */
const BlockIds = Extension.create({
  name: "w2BlockIds",
  addGlobalAttributes() {
    return [
      {
        types: TOP_LEVEL,
        attributes: {
          bid: { default: null, parseHTML: (el) => el.getAttribute("data-bid"), renderHTML: (a) => (a.bid ? { "data-bid": a.bid } : {}) },
        },
      },
      {
        types: ["heading"],
        attributes: { anchor: { default: null, renderHTML: (a) => (a.anchor ? { id: a.anchor } : {}) } },
      },
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          align: { default: null, renderHTML: (a) => (a.align ? { style: `text-align:${a.align}` } : {}) },
        },
      },
    ]
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("w2-bids"),
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged)) return null
          const seen = new Set<string>()
          const tr = state.tr
          state.doc.forEach((node, pos) => {
            const bid = node.attrs.bid as string | null
            if (!bid || seen.has(bid)) {
              if ("bid" in node.attrs) tr.setNodeAttribute(pos, "bid", newId())
            } else seen.add(bid)
          })
          return tr.docChanged ? tr.setMeta("addToHistory", false) : null
        },
      }),
    ]
  },
})

const ActiveBlockKey = new PluginKey<string | null>("w2-active")

/** Highlights the block the code view's cursor is in, and maps clicks on review marks to callbacks. */
const Interaction = Extension.create<{ bridge: EditorBridge }, { bridge: EditorBridge }>({
  name: "w2Interaction",
  addStorage() {
    return { bridge: this.options.bridge }
  },
  addProseMirrorPlugins() {
    const bridge = this.options.bridge
    return [
      new Plugin({
        key: ActiveBlockKey,
        state: {
          init: () => null as string | null,
          apply: (tr, v) => (tr.getMeta(ActiveBlockKey) !== undefined ? (tr.getMeta(ActiveBlockKey) as string | null) : v),
        },
        props: {
          decorations(state) {
            const bid = ActiveBlockKey.getState(state)
            if (!bid) return null
            let deco: Decoration | null = null
            state.doc.forEach((node, pos) => {
              if (node.attrs.bid === bid) deco = Decoration.node(pos, pos + node.nodeSize, { class: "w2-active-block" })
            })
            return deco ? DecorationSet.create(state.doc, [deco]) : null
          },
          handleClick(view, _pos, event) {
            const el = (event.target as HTMLElement).closest("[data-sid],[data-cid]") as HTMLElement | null
            if (!el || !view.dom.contains(el)) {
              bridge.emit("review", null)
              return false
            }
            const rect = el.getBoundingClientRect()
            bridge.emit("review", { sid: el.dataset.sid, cid: el.dataset.cid, rect })
            return false
          },
        },
      }),
    ]
  },
})

export function setActiveBlock(view: { state: { tr: unknown }; dispatch: (tr: never) => void } | null, bid: string | null) {
  if (!view) return
  const tr = (view.state.tr as { setMeta: (k: unknown, v: unknown) => unknown }).setMeta(ActiveBlockKey, bid)
  view.dispatch(tr as never)
}

// ---------------------------------------------------------------- marks

const reviewAttrs = {
  sid: { default: null, renderHTML: (a: Record<string, unknown>) => ({ "data-sid": a.sid }) },
  author: { default: null, renderHTML: (a: Record<string, unknown>) => (a.author ? { "data-author": a.author } : {}) },
  note: { default: null, renderHTML: (a: Record<string, unknown>) => (a.note ? { title: `${a.author ? "@" + a.author + ": " : ""}${a.note}` } : {}) },
}

const Insertion = Mark.create({
  name: "insertion",
  inclusive: false,
  addAttributes: () => reviewAttrs,
  parseHTML: () => [{ tag: "ins" }],
  renderHTML: ({ HTMLAttributes }) => ["ins", mergeAttributes(HTMLAttributes, { class: "w2-ins" }), 0],
})

const Deletion = Mark.create({
  name: "deletion",
  inclusive: false,
  addAttributes: () => reviewAttrs,
  parseHTML: () => [{ tag: "del" }],
  renderHTML: ({ HTMLAttributes }) => ["del", mergeAttributes(HTMLAttributes, { class: "w2-del" }), 0],
})

const Comment = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",
  addAttributes: () => ({
    cid: { default: null, renderHTML: (a) => ({ "data-cid": a.cid }) },
    thread: { default: [], rendered: false },
  }),
  parseHTML: () => [{ tag: "span[data-cid]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "w2-comment" }), 0],
})

const SmallCaps = Mark.create({
  name: "smallcaps",
  parseHTML: () => [{ tag: "span.w2-smallcaps" }],
  renderHTML: () => ["span", { class: "w2-smallcaps" }, 0],
})

// ---------------------------------------------------------------- nodes

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes: () => ({ variant: { default: "note" }, title: { default: null } }),
  parseHTML: () => [{ tag: "div.w2-callout" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { class: "w2-callout", "data-variant": node.attrs.variant }),
    ["div", { class: "w2-callout-title", contenteditable: "false" }, node.attrs.title || String(node.attrs.variant)],
    ["div", { class: "w2-callout-body" }, 0],
  ],
})

const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "block+",
  addAttributes: () => ({ count: { default: 2 } }),
  parseHTML: () => [{ tag: "div.w2-columns" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { class: "w2-columns", style: `column-count:${node.attrs.count}` }),
    0,
  ],
})

const SuggestionBlock = Node.create({
  name: "suggestionBlock",
  group: "block",
  content: "block+",
  addAttributes: () => ({ kind: { default: "insert" }, sid: { default: null }, author: { default: null }, note: { default: null } }),
  parseHTML: () => [{ tag: "div.w2-sugblock" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { class: "w2-sugblock", "data-kind": node.attrs.kind, "data-sid": node.attrs.sid }),
    [
      "div",
      { class: "w2-sugblock-label", contenteditable: "false", "data-sid": node.attrs.sid },
      `${node.attrs.kind === "insert" ? "Suggested insertion" : "Suggested deletion"}${node.attrs.author ? " · @" + node.attrs.author : ""}${node.attrs.note ? " — " + node.attrs.note : ""}`,
    ],
    ["div", { class: "w2-sugblock-body" }, 0],
  ],
})

const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div.w2-pagebreak" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "w2-pagebreak" }), ["span", {}, "Page break"]],
})

const ImageNode = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ src: { default: "" }, alt: { default: null }, caption: { default: null }, width: { default: null } }),
  parseHTML: () => [{ tag: "figure.w2-figure" }],
  renderHTML: ({ HTMLAttributes }) => ["figure", mergeAttributes(HTMLAttributes, { class: "w2-figure" })],
  addNodeView: () => ReactNodeViewRenderer(ImageView),
})

const ChartNode = Node.create({
  name: "chart",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ spec: { default: null } }),
  parseHTML: () => [{ tag: "div.w2-chart-node" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "w2-chart-node" })],
  addNodeView: () => ReactNodeViewRenderer(ChartView),
})

const TocNode = Node.create({
  name: "toc",
  group: "block",
  atom: true,
  addAttributes: () => ({ depth: { default: null }, title: { default: null } }),
  parseHTML: () => [{ tag: "nav.w2-toc" }],
  renderHTML: ({ HTMLAttributes }) => ["nav", mergeAttributes(HTMLAttributes, { class: "w2-toc" })],
  addNodeView: () => ReactNodeViewRenderer(TocView),
})

const ReferencesNode = Node.create({
  name: "references",
  group: "block",
  atom: true,
  addAttributes: () => ({ title: { default: null } }),
  parseHTML: () => [{ tag: "section.w2-references" }],
  renderHTML: ({ HTMLAttributes }) => ["section", mergeAttributes(HTMLAttributes, { class: "w2-references" })],
  addNodeView: () => ReactNodeViewRenderer(ReferencesView),
})

const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ content: { default: [] } }),
  parseHTML: () => [{ tag: "sup.w2-fn-ref" }],
  renderHTML: ({ HTMLAttributes }) => ["sup", mergeAttributes(HTMLAttributes, { class: "w2-fn-ref" })],
  addNodeView: () => ReactNodeViewRenderer(FootnoteView, { as: "span", className: "w2-fn-wrap" }),
})

const Cite = Node.create({
  name: "cite",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ keys: { default: [] }, locator: { default: null } }),
  parseHTML: () => [{ tag: "cite.w2-cite" }],
  renderHTML: ({ HTMLAttributes }) => ["cite", mergeAttributes(HTMLAttributes, { class: "w2-cite" })],
  addNodeView: () => ReactNodeViewRenderer(CiteView, { as: "span" }),
})

const CaptionedTable = Table.extend({
  addAttributes() {
    return { ...this.parent?.(), caption: { default: null, rendered: false } }
  },
  renderHTML({ node, HTMLAttributes }) {
    const caption = node.attrs.caption ? [["caption", { contenteditable: "false" }, node.attrs.caption]] : []
    return ["table", mergeAttributes(HTMLAttributes, { class: "w2-table" }), ...caption, ["tbody", 0]] as never
  },
})

export function createExtensions(bridge: EditorBridge): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: null, target: null } },
      codeBlock: { HTMLAttributes: { class: "w2-code" } },
      trailingNode: false,
    } as never),
    TaskList,
    TaskItem.configure({ nested: true }),
    CaptionedTable.configure({ resizable: false, View: null, renderWrapper: false } as never),
    TableRow,
    TableHeader,
    TableCell,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight,
    Subscript,
    Superscript,
    TextStyle,
    Color,
    SmallCaps,
    Insertion,
    Deletion,
    Comment,
    Callout,
    Columns,
    SuggestionBlock,
    PageBreak,
    ImageNode,
    ChartNode,
    TocNode,
    ReferencesNode,
    Footnote,
    Cite,
    TrackChanges,
    BlockIds,
    Interaction.configure({ bridge }),
    Pagination.configure({ bridge }),
    Placeholder.configure({ placeholder: "Type / for blocks, or ask Claude to draft something…", showOnlyWhenEditable: true }),
  ]
}
