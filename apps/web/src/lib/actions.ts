import { newId, serialize, type ChartSpec, type Document } from "@word2/sdk"
import { BLANK_DOCUMENT, useStore } from "../store"
import { useEditorRef } from "./editor"

const ed = () => useEditorRef.getState().editor

export const DEFAULT_CHART: ChartSpec = {
  chart: "bar",
  title: "New chart",
  x: "label",
  y: ["value"],
  data: [
    { label: "A", value: 12 },
    { label: "B", value: 19 },
    { label: "C", value: 8 },
  ],
}

export const insert = {
  table: () => ed()?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  chart: (spec: ChartSpec = DEFAULT_CHART) => ed()?.chain().focus().insertContent({ type: "chart", attrs: { spec } }).run(),
  image: (src: string, caption?: string) => ed()?.chain().focus().insertContent({ type: "image", attrs: { src, caption: caption ?? null } }).run(),
  footnote: () => ed()?.chain().focus().insertContent({ type: "footnote", attrs: { content: [{ type: "text", text: "Footnote text" }] } }).run(),
  cite: (key: string) => ed()?.chain().focus().insertContent({ type: "cite", attrs: { keys: [key], locator: null } }).run(),
  toc: () => ed()?.chain().focus().insertContent({ type: "toc" }).run(),
  references: () => ed()?.chain().focus().insertContent({ type: "references" }).run(),
  pageBreak: () => ed()?.chain().focus().insertContent({ type: "pageBreak" }).run(),
  divider: () => ed()?.chain().focus().setHorizontalRule().run(),
  callout: (variant = "note") =>
    ed()?.chain().focus().insertContent({ type: "callout", attrs: { variant, title: null }, content: [{ type: "paragraph" }] }).run(),
  columns: () =>
    ed()?.chain().focus().insertContent({ type: "columns", attrs: { count: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Text in two columns." }] }] }).run(),
  comment: (text: string) => {
    const e = ed()
    if (!e || e.state.selection.empty) return false
    return e.chain().focus().setMark("comment", { cid: newId("c"), thread: [{ author: "you", text }] }).run()
  },
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const fileBase = (doc: Document) => (doc.meta.title ?? "document").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "document"

export async function exportDocxFile() {
  const { exportDocx } = await import("@word2/sdk/docx")
  const doc = useStore.getState().doc
  download(`${fileBase(doc)}.docx`, await exportDocx(doc))
}

export function exportSource() {
  const { source, doc } = useStore.getState()
  download(`${fileBase(doc)}.w2.md`, new Blob([source], { type: "text/markdown" }))
}

export function exportCleanMarkdown() {
  const { doc } = useStore.getState()
  download(`${fileBase(doc)}.md`, new Blob([serialize(doc).text], { type: "text/markdown" }))
}

export async function openFile(file: File) {
  const text = await file.text()
  useStore.getState().setSource(text, "ui")
}

export function newDocument() {
  useStore.getState().setSource(BLANK_DOCUMENT, "ui")
}
