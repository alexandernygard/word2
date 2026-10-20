import { ensureIds, newId } from "./ids"
import { inlineText } from "./inline"
import type { Block, CiteNode, DocMeta, Document, FootnoteNode, Heading, Reference } from "./model"
import { blocksText, forEachInline } from "./suggest"

// ------------------------------------------------------------ outline & sections

export type OutlineItem = { id: string; level: number; text: string; index: number; number?: string }

/** Top-level headings in order, with optional "1.2.3" numbering. */
export function outline(doc: Document): OutlineItem[] {
  const counters = [0, 0, 0, 0, 0, 0]
  const items: OutlineItem[] = []
  doc.blocks.forEach((b, index) => {
    if (b.type !== "heading") return
    counters[b.level - 1]++
    for (let k = b.level; k < 6; k++) counters[k] = 0
    const number = counters.slice(0, b.level).join(".").replace(/^(0\.)+/, "")
    items.push({ id: b.id, level: b.level, text: inlineText(b.content), index, number })
  })
  return items
}

/** [start, end) of the section a heading opens: up to the next heading of the same or higher level. */
export function sectionRange(blocks: Block[], headingId: string): [number, number] | null {
  const start = blocks.findIndex((b) => b.id === headingId)
  const h = blocks[start]
  if (!h || h.type !== "heading") return null
  let end = start + 1
  while (end < blocks.length) {
    const b = blocks[end]
    if (b.type === "heading" && b.level <= h.level) break
    end++
  }
  return [start, end]
}

/** Move a section (heading + its content) before another block, or to the end when `beforeId` is null. */
export function moveSection(doc: Document, headingId: string, beforeId: string | null): Document {
  const range = sectionRange(doc.blocks, headingId)
  if (!range) return doc
  const [s, e] = range
  const section = doc.blocks.slice(s, e)
  if (beforeId && section.some((b) => b.id === beforeId)) return doc
  const rest = [...doc.blocks.slice(0, s), ...doc.blocks.slice(e)]
  const at = beforeId ? rest.findIndex((b) => b.id === beforeId) : rest.length
  if (at < 0) return doc
  return { ...doc, blocks: [...rest.slice(0, at), ...section, ...rest.slice(at)] }
}

/** Change a heading's level, together with all sub-headings in its section. */
export function shiftSection(doc: Document, headingId: string, delta: number): Document {
  const range = sectionRange(doc.blocks, headingId)
  if (!range) return doc
  const blocks = doc.blocks.map((b, i) => {
    if (i < range[0] || i >= range[1] || b.type !== "heading") return b
    return { ...b, level: Math.min(6, Math.max(1, b.level + delta)) as Heading["level"] }
  })
  return { ...doc, blocks }
}

// ------------------------------------------------------------ block edits

export function insertBlocks(doc: Document, afterId: string | null, blocks: Block[]): Document {
  const at = afterId === null ? 0 : doc.blocks.findIndex((b) => b.id === afterId) + 1
  const idx = at <= 0 && afterId !== null ? doc.blocks.length : at
  return ensureIds({ ...doc, blocks: [...doc.blocks.slice(0, idx), ...blocks, ...doc.blocks.slice(idx)] })
}

export function replaceBlocks(doc: Document, ids: string[], blocks: Block[]): Document {
  const first = doc.blocks.findIndex((b) => ids.includes(b.id))
  if (first < 0) return doc
  const kept = doc.blocks.filter((b, i) => i < first || !ids.includes(b.id))
  kept.splice(first, 0, ...blocks)
  return ensureIds({ ...doc, blocks: kept })
}

export function removeBlocks(doc: Document, ids: string[]): Document {
  return { ...doc, blocks: doc.blocks.filter((b) => !ids.includes(b.id)) }
}

export function updateMeta(doc: Document, patch: Partial<DocMeta>): Document {
  const meta: DocMeta = { ...doc.meta }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "") delete meta[k]
    else if (typeof v === "object" && !Array.isArray(v) && meta[k] && typeof meta[k] === "object")
      meta[k] = { ...(meta[k] as object), ...(v as object) }
    else meta[k] = v
  }
  return { ...doc, meta }
}

export function emptyParagraph(): Block {
  return { id: newId(), type: "paragraph", content: [] }
}

// ------------------------------------------------------------ text, footnotes, citations

export function plainText(doc: Document): string {
  return blocksText(doc.blocks)
}

export function wordCount(doc: Document): number {
  return (plainText(doc).match(/[\p{L}\p{N}'’-]+/gu) ?? []).length
}

/** All footnotes in document order (numbered from 1). */
export function footnotes(doc: Document): FootnoteNode[] {
  const out: FootnoteNode[] = []
  forEachInline(doc.blocks, (content) => {
    for (const n of content) if (n.type === "footnote") out.push(n)
  })
  return out
}

/** Footnote numbers per top-level block id (first number, count). */
export function footnoteIndex(doc: Document): Map<string, number[]> {
  const map = new Map<string, number[]>()
  let k = 0
  forEachInline(doc.blocks, (content, top) => {
    for (const n of content) {
      if (n.type !== "footnote") continue
      k++
      const list = map.get(top.id) ?? []
      list.push(k)
      map.set(top.id, list)
    }
  })
  return map
}

export function citedKeys(doc: Document): string[] {
  const keys: string[] = []
  forEachInline(doc.blocks, (content) => {
    for (const n of content) if (n.type === "cite") for (const k of n.keys) if (!keys.includes(k)) keys.push(k)
  })
  return keys
}

const surname = (author?: string) => (author ?? "").split(/,| and |&/)[0].trim().split(/\s+/).pop() ?? ""

export function formatCitation(cite: CiteNode, meta: DocMeta, order: string[]): string {
  const refs = meta.references ?? []
  if (meta.citationStyle === "numeric") {
    const nums = cite.keys.map((k) => (order.indexOf(k) + 1 || "?").toString())
    return `[${nums.join(", ")}${cite.locator ? ", " + cite.locator : ""}]`
  }
  const parts = cite.keys.map((k) => {
    const r = refs.find((x) => x.id === k)
    if (!r) return k
    const multi = (r.author ?? "").includes(" and ") || (r.author ?? "").includes("&")
    return `${surname(r.author) || r.title}${multi ? " et al." : ""}, ${r.year ?? "n.d."}`
  })
  return `(${parts.join("; ")}${cite.locator ? ", " + cite.locator : ""})`
}

export function formatReference(r: Reference): string {
  return [r.author, r.year ? `(${r.year})` : "", r.title ? `${r.title}.` : "", r.publisher ? `${r.publisher}.` : "", r.url ?? ""]
    .filter(Boolean)
    .join(" ")
}

/** References to list in a bibliography: cited ones in citation order, then uncited. */
export function bibliography(doc: Document): Reference[] {
  const refs = doc.meta.references ?? []
  const order = citedKeys(doc)
  const cited = order.map((k) => refs.find((r) => r.id === k)).filter(Boolean) as Reference[]
  const style = doc.meta.citationStyle
  if (style === "numeric") return cited
  return [...cited].sort((a, b) => surname(a.author).localeCompare(surname(b.author)))
}

/** Fill a header/footer template. */
export function fillTemplate(tpl: string, fields: { page: number; pages: number; meta: DocMeta; section?: string }): string[] {
  const f: Record<string, string> = {
    page: String(fields.page),
    pages: String(fields.pages),
    title: fields.meta.title ?? "",
    author: fields.meta.author ?? "",
    date: fields.meta.date ?? "",
    section: fields.section ?? "",
  }
  const filled = tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => f[k] ?? "")
  const parts = filled.split("|").map((s) => s.trim())
  if (parts.length === 1) return ["", parts[0], ""]
  if (parts.length === 2) return [parts[0], "", parts[1]]
  return parts.slice(0, 3)
}
