/**
 * Conversion between the word2 document model and ProseMirror JSON (TipTap schema).
 * Pure functions on JSON so they can be tested without a DOM.
 *
 * Top-level PM nodes carry the block id in a `bid` attribute so identity survives
 * the round trip editor → model → editor; that is what keeps editor diffs minimal.
 */
import { newId, normalizeInlines, type Align, type Block, type ChartSpec, type Inline, type ListItem, type Mark } from "@word2/sdk"

export type PMMark = { type: string; attrs?: Record<string, unknown> }
export type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; marks?: PMMark[]; text?: string }

// ------------------------------------------------------------ model → PM

function markToPM(m: Mark): PMMark {
  switch (m.type) {
    case "sup":
      return { type: "superscript" }
    case "sub":
      return { type: "subscript" }
    case "color":
      return { type: "textStyle", attrs: { color: m.color } }
    case "link":
      return { type: "link", attrs: { href: m.href, title: m.title ?? null } }
    case "insertion":
    case "deletion":
      return { type: m.type, attrs: { sid: m.id, author: m.author ?? null, note: m.note ?? null } }
    case "comment":
      return { type: "comment", attrs: { cid: m.id, thread: m.thread } }
    default:
      return { type: m.type }
  }
}

const pmMarks = (marks?: Mark[]) => {
  if (!marks?.length) return {}
  // `code` excludes other formatting marks in the schema; review marks still apply
  const hasCode = marks.some((m) => m.type === "code")
  const kept = hasCode ? marks.filter((m) => ["code", "insertion", "deletion", "comment", "link"].includes(m.type)) : marks
  return { marks: kept.map(markToPM) }
}

export function inlinesToPM(content: Inline[]): PMNode[] {
  const out: PMNode[] = []
  for (const n of content) {
    if (n.type === "text") {
      if (n.text) out.push({ type: "text", text: n.text, ...pmMarks(n.marks) })
    } else if (n.type === "break") out.push({ type: "hardBreak", ...pmMarks(n.marks) })
    else if (n.type === "footnote") out.push({ type: "footnote", attrs: { content: n.content }, ...pmMarks(n.marks) })
    else out.push({ type: "cite", attrs: { keys: n.keys, locator: n.locator ?? null }, ...pmMarks(n.marks) })
  }
  return out
}

const withContent = (type: string, attrs: Record<string, unknown>, content: PMNode[]): PMNode =>
  content.length ? { type, attrs, content } : { type, attrs }

function itemToPM(it: ListItem, task: boolean): PMNode {
  const blocks = it.blocks.map((b) => blockToPM(b, false))
  if (blocks[0]?.type !== "paragraph") blocks.unshift({ type: "paragraph" })
  return task ? { type: "taskItem", attrs: { checked: !!it.checked }, content: blocks } : { type: "listItem", content: blocks }
}

export function blockToPM(b: Block, top = true): PMNode {
  const bid = top ? { bid: b.id } : {}
  switch (b.type) {
    case "paragraph":
      return withContent("paragraph", { ...bid, textAlign: b.align ?? null }, inlinesToPM(b.content))
    case "heading":
      return withContent("heading", { ...bid, level: b.level, anchor: b.anchor ?? null, textAlign: b.align ?? null }, inlinesToPM(b.content))
    case "list":
      if (b.kind === "task") return { type: "taskList", attrs: bid, content: b.items.map((i) => itemToPM(i, true)) }
      if (b.kind === "ordered") return { type: "orderedList", attrs: { ...bid, start: b.start ?? 1 }, content: b.items.map((i) => itemToPM(i, false)) }
      return { type: "bulletList", attrs: bid, content: b.items.map((i) => itemToPM(i, false)) }
    case "blockquote":
      return { type: "blockquote", attrs: bid, content: blocksOrPara(b.blocks) }
    case "callout":
      return { type: "callout", attrs: { ...bid, variant: b.variant, title: b.title ?? null }, content: blocksOrPara(b.blocks) }
    case "columns":
      return { type: "columns", attrs: { ...bid, count: b.count }, content: blocksOrPara(b.blocks) }
    case "suggestion":
      return {
        type: "suggestionBlock",
        attrs: { ...bid, kind: b.kind, sid: b.sid, author: b.author ?? null, note: b.note ?? null },
        content: blocksOrPara(b.blocks),
      }
    case "code":
      return withContent("codeBlock", { ...bid, language: b.lang ?? null }, b.text ? [{ type: "text", text: b.text }] : [])
    case "table": {
      const width = Math.max(1, ...b.rows.map((r) => r.cells.length))
      return {
        type: "table",
        attrs: { ...bid, caption: b.caption ?? null },
        content: b.rows.map((r, ri) => ({
          type: "tableRow",
          content: Array.from({ length: width }, (_, ci) => {
            const c = r.cells[ci] ?? { content: [] }
            return {
              type: b.header && ri === 0 ? "tableHeader" : "tableCell",
              attrs: { align: c.align ?? null },
              content: [withContent("paragraph", {}, inlinesToPM(c.content))],
            }
          }),
        })),
      }
    }
    case "image":
      return { type: "image", attrs: { ...bid, src: b.src, alt: b.alt ?? null, caption: b.caption ?? null, width: b.width ?? null } }
    case "chart": {
      const { id: _id, type: _t, ...spec } = b
      return { type: "chart", attrs: { ...bid, spec } }
    }
    case "divider":
      return { type: "horizontalRule", attrs: bid }
    case "pagebreak":
      return { type: "pageBreak", attrs: bid }
    case "toc":
      return { type: "toc", attrs: { ...bid, depth: b.depth ?? null, title: b.title ?? null } }
    case "references":
      return { type: "references", attrs: { ...bid, title: b.title ?? null } }
  }
}

function blocksOrPara(blocks: Block[]): PMNode[] {
  const out = blocks.map((b) => blockToPM(b, false))
  return out.length ? out : [{ type: "paragraph" }]
}

export function docToPM(blocks: Block[]): PMNode {
  const content = blocks.map((b) => blockToPM(b))
  return { type: "doc", content: content.length ? content : [{ type: "paragraph", attrs: { bid: newId() } }] }
}

// ------------------------------------------------------------ PM → model

function markFromPM(m: PMMark): Mark | null {
  const a = m.attrs ?? {}
  switch (m.type) {
    case "bold":
    case "italic":
    case "underline":
    case "strike":
    case "code":
    case "highlight":
    case "smallcaps":
      return { type: m.type }
    case "superscript":
      return { type: "sup" }
    case "subscript":
      return { type: "sub" }
    case "textStyle":
      return a.color ? { type: "color", color: String(a.color) } : null
    case "link":
      return a.title ? { type: "link", href: String(a.href ?? ""), title: String(a.title) } : { type: "link", href: String(a.href ?? "") }
    case "insertion":
    case "deletion":
      return {
        type: m.type,
        id: String(a.sid ?? newId("s")),
        ...(a.author ? { author: String(a.author) } : {}),
        ...(a.note ? { note: String(a.note) } : {}),
      }
    case "comment":
      return { type: "comment", id: String(a.cid ?? newId("c")), thread: (a.thread as never) ?? [] }
    default:
      return null
  }
}

const modelMarks = (marks?: PMMark[]): { marks?: Mark[] } => {
  const ms = (marks ?? []).map(markFromPM).filter(Boolean) as Mark[]
  return ms.length ? { marks: ms } : {}
}

export function inlinesFromPM(nodes: PMNode[] = []): Inline[] {
  const out: Inline[] = []
  for (const n of nodes) {
    if (n.type === "text") out.push({ type: "text", text: n.text ?? "", ...modelMarks(n.marks) })
    else if (n.type === "hardBreak") out.push({ type: "break", ...modelMarks(n.marks) })
    else if (n.type === "footnote") out.push({ type: "footnote", content: (n.attrs?.content as Inline[]) ?? [], ...modelMarks(n.marks) })
    else if (n.type === "cite") {
      const keys = (n.attrs?.keys as string[]) ?? []
      const locator = n.attrs?.locator as string | null
      out.push({ type: "cite", keys, ...(locator ? { locator } : {}), ...modelMarks(n.marks) })
    }
  }
  return normalizeInlines(out)
}

const align = (a?: Record<string, unknown>) => {
  const v = a?.textAlign as Align | null | undefined
  return v && v !== "left" ? { align: v } : {}
}

function itemsFromPM(n: PMNode): ListItem[] {
  return (n.content ?? []).map((it) => ({
    blocks: (it.content ?? []).map((c) => blockFromPM(c, false)),
    ...(it.type === "taskItem" ? { checked: !!it.attrs?.checked } : {}),
  }))
}

export function blockFromPM(n: PMNode, top = true): Block {
  const a = n.attrs ?? {}
  const id = (top && (a.bid as string)) || newId()
  const kids = () => (n.content ?? []).map((c) => blockFromPM(c, false))
  switch (n.type) {
    case "heading":
      return {
        id,
        type: "heading",
        level: (Number(a.level) || 1) as 1,
        content: inlinesFromPM(n.content),
        ...(a.anchor ? { anchor: String(a.anchor) } : {}),
        ...align(a),
      }
    case "bulletList":
      return { id, type: "list", kind: "bullet", items: itemsFromPM(n) }
    case "orderedList": {
      const start = Number(a.start ?? 1)
      return { id, type: "list", kind: "ordered", items: itemsFromPM(n), ...(start !== 1 ? { start } : {}) }
    }
    case "taskList":
      return { id, type: "list", kind: "task", items: itemsFromPM(n) }
    case "blockquote":
      return { id, type: "blockquote", blocks: kids() }
    case "callout":
      return { id, type: "callout", variant: (a.variant as "note") ?? "note", ...(a.title ? { title: String(a.title) } : {}), blocks: kids() }
    case "columns":
      return { id, type: "columns", count: Number(a.count) || 2, blocks: kids() }
    case "suggestionBlock":
      return {
        id,
        type: "suggestion",
        kind: a.kind === "delete" ? "delete" : "insert",
        sid: String(a.sid ?? newId("s")),
        ...(a.author ? { author: String(a.author) } : {}),
        ...(a.note ? { note: String(a.note) } : {}),
        blocks: kids(),
      }
    case "codeBlock":
      return { id, type: "code", text: (n.content ?? []).map((t) => t.text ?? "").join(""), ...(a.language ? { lang: String(a.language) } : {}) }
    case "table": {
      const rows = (n.content ?? []).map((r) => ({
        cells: (r.content ?? []).map((c) => {
          const paras = (c.content ?? []).filter((p) => p.type === "paragraph")
          const content: Inline[] = []
          paras.forEach((p, k) => {
            if (k > 0) content.push({ type: "break" })
            content.push(...inlinesFromPM(p.content))
          })
          const al = c.attrs?.align as Align | null
          return { content: normalizeInlines(content), ...(al ? { align: al } : {}) }
        }),
      }))
      const header = n.content?.[0]?.content?.every((c) => c.type === "tableHeader") ?? false
      return { id, type: "table", header, rows, ...(a.caption ? { caption: String(a.caption) } : {}) }
    }
    case "image":
      return {
        id,
        type: "image",
        src: String(a.src ?? ""),
        ...(a.alt ? { alt: String(a.alt) } : {}),
        ...(a.caption ? { caption: String(a.caption) } : {}),
        ...(a.width ? { width: String(a.width) } : {}),
      }
    case "chart":
      return { id, type: "chart", ...((a.spec as ChartSpec) ?? { chart: "bar", x: "x", y: [], data: [] }) }
    case "horizontalRule":
      return { id, type: "divider" }
    case "pageBreak":
      return { id, type: "pagebreak" }
    case "toc":
      return { id, type: "toc", ...(a.depth ? { depth: Number(a.depth) } : {}), ...(a.title ? { title: String(a.title) } : {}) }
    case "references":
      return { id, type: "references", ...(a.title ? { title: String(a.title) } : {}) }
    case "paragraph":
    default:
      return { id, type: "paragraph", content: inlinesFromPM(n.content), ...align(a) }
  }
}

export function docFromPM(doc: PMNode): Block[] {
  return (doc.content ?? []).map((n) => blockFromPM(n))
}
