import { stringify as stringifyYaml } from "yaml"
import { contentKey } from "./ids"
import { serializeInline } from "./inline"
import type { Block, Chart, DocMeta, Document, Inline, ListItem, Table } from "./model"
import type { BlockSource, ParseResult } from "./parse"

/**
 * Maps a block's content key to the exact source text it was parsed from, so
 * unchanged blocks are written back byte-for-byte (the user's own formatting in
 * the code view survives WYSIWYG edits elsewhere in the document).
 */
export type SourceCache = { blocks: Map<string, string>; meta?: { key: string; text: string } }

export function buildSourceCache(src: string, result: ParseResult): SourceCache {
  const blocks = new Map<string, string>()
  result.doc.blocks.forEach((b, i) => {
    const s = result.sources[i]
    if (s) blocks.set(contentKey(b), src.slice(s.from, s.to))
  })
  const meta = result.frontMatter
    ? { key: contentKey(result.doc.meta), text: src.slice(result.frontMatter.from, result.frontMatter.to) }
    : undefined
  return { blocks, meta }
}

const LINE_START = /^(#{1,6}(\s|$)|>|[-*+](\s|$)|\d+[.)](\s|$)|:::|::\w|\||!\[|```|~~~|Table:|\[\^[^\]]+\]:)/

function escapeLineStarts(s: string): string {
  return s
    .split("\n")
    .map((line) => {
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return "\\" + line
      const m = LINE_START.exec(line)
      if (!m) return line
      const d = /^\d+/.exec(line)
      return d ? `${d[0]}\\${line.slice(d[0].length)}` : "\\" + line
    })
    .join("\n")
}

function inline(content: Inline[]): string {
  return escapeLineStarts(serializeInline(content))
}

const indent = (s: string, pad: string) =>
  s
    .split("\n")
    .map((l, i) => (i === 0 || l === "" ? l : pad + l))
    .join("\n")

function attrValue(v: string) {
  return /^[\w#%.,/-]+$/.test(v) ? v : `"${v.replace(/"/g, '\\"')}"`
}

function serializeItem(item: ListItem, marker: string, padWidth = marker.length + 1): string {
  const pad = " ".repeat(padWidth)
  const parts = item.blocks.map(serializeBlock)
  // paragraph followed by a nested list stays tight; anything else is separated by a blank line
  let body = ""
  item.blocks.forEach((b, i) => {
    if (i === 0) body = parts[0]
    else body += (b.type === "list" && item.blocks[i - 1].type === "paragraph" ? "\n" : "\n\n") + parts[i]
  })
  return `${marker} ${indent(body, pad)}`.trimEnd()
}

function isLoose(items: ListItem[]): boolean {
  return items.some((it) => it.blocks.length > 2 || (it.blocks.length === 2 && it.blocks[1].type !== "list") || (it.blocks[0] && it.blocks[0].type !== "paragraph" && it.blocks[0].type !== "list"))
}

function serializeTable(t: Table): string {
  const width = Math.max(1, ...t.rows.map((r) => r.cells.length))
  const cell = (r: number, c: number) => serializeInline(t.rows[r]?.cells[c]?.content ?? [], { table: true })
  const rows = t.rows.map((_, r) => Array.from({ length: width }, (_, c) => cell(r, c)))
  const all = t.header ? rows : [Array(width).fill(""), ...rows]
  const aligns = Array.from({ length: width }, (_, c) => t.rows[0]?.cells[c]?.align)
  const widths = Array.from({ length: width }, (_, c) => Math.min(40, Math.max(3, ...all.map((r) => r[c].length))))
  const line = (cells: string[]) => "| " + cells.map((s, c) => s.padEnd(widths[c])).join(" | ") + " |"
  const delim =
    "| " +
    widths
      .map((w, c) => {
        const a = aligns[c]
        const dash = "-".repeat(Math.max(3, w - (a === "center" ? 2 : a ? 1 : 0)))
        return a === "center" ? `:${dash}:` : a === "right" ? `${dash}:` : a === "left" ? `:${dash}` : dash
      })
      .join(" | ") +
    " |"
  const out = [line(all[0]), delim, ...all.slice(1).map(line)]
  if (t.caption) out.push("", `Table: ${t.caption}`)
  return out.join("\n")
}

function csvCell(v: string | number | undefined): string {
  const s = v === undefined ? "" : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function serializeChart(c: Chart): string {
  const cols = [c.x, ...c.y.filter((y) => y !== c.x)]
  for (const d of c.data) for (const k of Object.keys(d)) if (!cols.includes(k)) cols.push(k)
  const head = [`type: ${c.chart}`]
  if (c.title) head.push(`title: ${c.title}`)
  head.push(`x: ${c.x}`, `y: ${c.y.join(", ")}`)
  if (c.stacked) head.push("stacked: true")
  if (c.caption) head.push(`caption: ${c.caption}`)
  const csv = [cols.map(csvCell).join(","), ...c.data.map((d) => cols.map((k) => csvCell(d[k])).join(","))]
  return ["```chart", ...head, "---", ...csv, "```"].join("\n")
}

function container(name: string, attrs: string, blocks: Block[], label?: string): string {
  const inner = blocks.map(serializeBlock).join("\n\n")
  // nested containers need a longer fence so the closing `:::` is unambiguous for readers
  const depth = (s: string) => Math.max(0, ...[...s.matchAll(/^(:{3,})/gm)].map((m) => m[1].length))
  const fence = ":".repeat(Math.max(3, depth(inner) + 1))
  return `${fence}${name}${label ? `[${label.replace(/[[\]]/g, "")}]` : ""}${attrs ? `{${attrs}}` : ""}\n${inner}\n${fence}`
}

export function serializeBlock(b: Block): string {
  switch (b.type) {
    case "paragraph":
      return inline(b.content) + (b.align && b.align !== "left" ? ` {.${b.align}}` : "")
    case "heading": {
      const attrs = [b.anchor ? `#${b.anchor}` : "", b.align && b.align !== "left" ? `.${b.align}` : ""].filter(Boolean).join(" ")
      const body = serializeInline(b.content, { table: true })
      return `${"#".repeat(b.level)} ${body}${attrs ? ` {${attrs}}` : ""}`.trimEnd()
    }
    case "list": {
      const loose = isLoose(b.items)
      const start = b.start ?? 1
      return b.items
        .map((it, i) => {
          const marker = b.kind === "ordered" ? `${start + i}.` : b.kind === "task" ? `- [${it.checked ? "x" : " "}]` : "-"
          return serializeItem(it, marker, b.kind === "task" ? 2 : undefined)
        })
        .map((s, i, arr) => s + (i < arr.length - 1 && loose ? "\n" : ""))
        .join("\n")
    }
    case "blockquote":
      return b.blocks
        .map(serializeBlock)
        .join("\n\n")
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n")
    case "callout":
      return container(b.variant, "", b.blocks, b.title)
    case "columns":
      return container("columns", `count=${b.count}`, b.blocks)
    case "suggestion": {
      const attrs = [`type=${b.kind}`, b.author ? `by=${attrValue(b.author)}` : "", b.note ? `note=${attrValue(b.note)}` : ""]
      return container("suggest", attrs.filter(Boolean).join(" "), b.blocks)
    }
    case "code": {
      const fence = b.text.includes("```") ? "````" : "```"
      return `${fence}${b.lang ?? ""}\n${b.text}\n${fence}`
    }
    case "table":
      return serializeTable(b)
    case "image": {
      const cap = b.caption ? ` "${b.caption.replace(/"/g, "'")}"` : ""
      const src = /\s/.test(b.src) ? `<${b.src}>` : b.src
      return `![${(b.alt ?? "").replace(/[[\]]/g, "")}](${src}${cap})${b.width ? `{width=${b.width}}` : ""}`
    }
    case "chart":
      return serializeChart(b)
    case "divider":
      return "---"
    case "pagebreak":
      return "::pagebreak"
    case "toc":
      return `::toc${b.title ? `[${b.title}]` : ""}${b.depth ? `{depth=${b.depth}}` : ""}`
    case "references":
      return `::references${b.title ? `[${b.title}]` : ""}`
  }
}

const META_ORDER = ["title", "subtitle", "author", "date", "page", "theme", "styles", "header", "footer", "titlePage", "numberedHeadings", "citationStyle", "ai", "references"]

export function serializeMeta(meta: DocMeta): string {
  const keys = Object.keys(meta).filter((k) => meta[k] !== undefined && meta[k] !== null && meta[k] !== "")
  if (!keys.length) return ""
  keys.sort((a, b) => {
    const ia = META_ORDER.indexOf(a)
    const ib = META_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const ordered = Object.fromEntries(keys.map((k) => [k, meta[k]]))
  return `---\n${stringifyYaml(ordered, { lineWidth: 0 }).trimEnd()}\n---`
}

export type SerializeResult = { text: string; sources: BlockSource[]; frontMatter?: { from: number; to: number } }

/** Serialize a document to source. With a cache, unchanged blocks keep their original text. */
export function serialize(doc: Document, cache?: SourceCache): SerializeResult {
  const parts: string[] = []
  const sources: BlockSource[] = []
  let frontMatter: SerializeResult["frontMatter"]
  let pos = 0
  const mk = contentKey(doc.meta)
  const metaText = cache?.meta && cache.meta.key === mk ? cache.meta.text : serializeMeta(doc.meta)
  if (metaText) {
    parts.push(metaText)
    frontMatter = { from: 0, to: metaText.length }
    pos = metaText.length + 2
  }
  for (const b of doc.blocks) {
    const text = cache?.blocks.get(contentKey(b)) ?? serializeBlock(b)
    sources.push({ id: b.id, from: pos, to: pos + text.length })
    parts.push(text)
    pos += text.length + 2
  }
  return { text: parts.join("\n\n") + "\n", sources, frontMatter }
}
