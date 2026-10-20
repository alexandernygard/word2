import { contentKey, newId } from "./ids"
import { hasMark, inlineText, markEq, normalizeInlines } from "./inline"
import type { Block, CommentMessage, Document, Inline, ListItem, Mark } from "./model"

// ------------------------------------------------------------ traversal

/** Map every block (depth first, children before parent rebuild). Return null to delete, an array to splice. */
export function mapBlocks(blocks: Block[], fn: (b: Block) => Block | Block[] | null): Block[] {
  const out: Block[] = []
  for (const b of blocks) {
    let nb: Block = b
    switch (b.type) {
      case "blockquote":
      case "callout":
      case "columns":
      case "suggestion":
        nb = { ...b, blocks: mapBlocks(b.blocks, fn) }
        break
      case "list":
        nb = {
          ...b,
          items: b.items
            .map((it) => ({ ...it, blocks: mapBlocks(it.blocks, fn) }))
            .filter((it) => it.blocks.length > 0),
        }
        if (nb.items.length === 0) continue
        break
    }
    const r = fn(nb)
    if (r === null) continue
    if (Array.isArray(r)) out.push(...r)
    else out.push(r)
  }
  return out
}

/** Map inline content of every text-bearing block (paragraphs, headings, table cells). */
export function mapInlines(blocks: Block[], fn: (c: Inline[]) => Inline[]): Block[] {
  const mapFootnotes = (c: Inline[]) => c.map((n) => (n.type === "footnote" ? { ...n, content: fn(n.content) } : n))
  return mapBlocks(blocks, (b) => {
    if (b.type === "paragraph" || b.type === "heading") return { ...b, content: normalizeInlines(fn(mapFootnotes(b.content))) }
    if (b.type === "table")
      return { ...b, rows: b.rows.map((r) => ({ cells: r.cells.map((c) => ({ ...c, content: normalizeInlines(fn(mapFootnotes(c.content))) })) })) }
    return b
  })
}

export function forEachInline(blocks: Block[], fn: (c: Inline[], top: Block) => void) {
  const visit = (b: Block, top: Block) => {
    if (b.type === "paragraph" || b.type === "heading") {
      fn(b.content, top)
      for (const n of b.content) if (n.type === "footnote") fn(n.content, top)
    } else if (b.type === "table") b.rows.forEach((r) => r.cells.forEach((c) => fn(c.content, top)))
    else if (b.type === "list") b.items.forEach((it) => it.blocks.forEach((x) => visit(x, top)))
    else if ("blocks" in b) b.blocks.forEach((x) => visit(x, top))
  }
  blocks.forEach((b) => visit(b, b))
}

// ------------------------------------------------------------ diff

type Token = { node: Inline; key: string }

const REVIEW = new Set(["insertion", "deletion", "comment"])
const plainMarks = (marks: Mark[] = []) => marks.filter((m) => !REVIEW.has(m.type))

function tokenize(content: Inline[]): Token[] {
  const out: Token[] = []
  for (const n of content) {
    if (n.type !== "text") {
      out.push({ node: n, key: contentKey({ ...n, marks: plainMarks(n.marks) }) })
      continue
    }
    for (const piece of n.text.match(/\s+|[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}]/gu) ?? []) {
      const node = { ...n, text: piece }
      out.push({ node, key: piece + "\u0000" + contentKey(plainMarks(n.marks)) })
    }
  }
  return out
}

/** The text as it reads with all pending suggestions applied (insertions kept, deletions dropped). */
export function proposedView(content: Inline[]): Inline[] {
  return content
    .filter((n) => !hasMark(n, "deletion"))
    .map((n) => ({ ...n, marks: (n.marks ?? []).filter((m) => m.type !== "insertion") }) as Inline)
}

type Op = { t: "eq" | "del" | "ins"; tok: Token }

function lcsDiff(a: Token[], b: Token[]): Op[] | null {
  const n = a.length
  const m = b.length
  if (n * m > 4_000_000) return null
  // trim common prefix/suffix first
  let pre = 0
  while (pre < n && pre < m && a[pre].key === b[pre].key) pre++
  let suf = 0
  while (suf < n - pre && suf < m - pre && a[n - 1 - suf].key === b[m - 1 - suf].key) suf++
  const A = a.slice(pre, n - suf)
  const B = b.slice(pre, m - suf)
  const dp: Uint32Array[] = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1))
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i].key === B[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const ops: Op[] = a.slice(0, pre).map((tok) => ({ t: "eq" as const, tok }))
  let i = 0
  let j = 0
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i].key === B[j].key) {
      ops.push({ t: "eq", tok: A[i] })
      i++
      j++
    } else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ t: "ins", tok: B[j++] })
    } else ops.push({ t: "del", tok: A[i++] })
  }
  ops.push(...a.slice(n - suf).map((tok) => ({ t: "eq" as const, tok })))
  return ops
}

export type SuggestionMeta = { author?: string; note?: string }

const addMark = (n: Inline, m: Mark): Inline => ({ ...n, marks: [...(n.marks ?? []), m] }) as Inline

/**
 * Turn "old content → new content" into tracked changes: unchanged words stay,
 * each changed region becomes one suggestion (a deletion and/or insertion sharing an id).
 */
export function diffInlines(oldContent: Inline[], newContent: Inline[], meta: SuggestionMeta = {}): Inline[] {
  const a = tokenize(proposedView(oldContent))
  const b = tokenize(newContent)
  const ops = lcsDiff(a, b) ?? [...a.map((tok) => ({ t: "del" as const, tok })), ...b.map((tok) => ({ t: "ins" as const, tok }))]

  // group into regions; tiny equal runs (whitespace) between changes are absorbed into the region
  type Region = { eq: Token[] } | { del: Token[]; ins: Token[] }
  const regions: Region[] = []
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    const last = regions[regions.length - 1]
    if (op.t === "eq") {
      // whitespace-only equal run sandwiched between changes → merge into the change
      let e = k
      while (e < ops.length && ops[e].t === "eq") e++
      const run = ops.slice(k, e).map((o) => o.tok)
      const between = last && "del" in last && e < ops.length
      if (between && run.every((t) => t.node.type === "text" && /^\s+$/.test(t.node.text))) {
        last.del.push(...run)
        last.ins.push(...run)
      } else regions.push({ eq: run })
      k = e - 1
    } else {
      const r = last && "del" in last ? last : (regions.push({ del: [], ins: [] }), regions[regions.length - 1] as { del: Token[]; ins: Token[] })
      if (op.t === "del") r.del.push(op.tok)
      else r.ins.push(op.tok)
    }
  }

  const out: Inline[] = []
  for (const r of regions) {
    if ("eq" in r) {
      out.push(...r.eq.map((t) => t.node))
      continue
    }
    const id = newId("s")
    const base = { id, ...(meta.author ? { author: meta.author } : {}), ...(meta.note ? { note: meta.note } : {}) }
    out.push(...r.del.map((t) => addMark(t.node, { type: "deletion", ...base })))
    out.push(...r.ins.map((t) => addMark({ ...t.node, marks: plainMarks(t.node.marks) } as Inline, { type: "insertion", ...base })))
  }
  return normalizeInlines(out)
}

function wrap(kind: "insert" | "delete", blocks: Block[], meta: SuggestionMeta): Block {
  return { id: newId(), type: "suggestion", kind, sid: newId("s"), ...meta, blocks }
}

const textBearing = (b: Block) => b.type === "paragraph" || b.type === "heading"

/** Propose replacing `oldBlocks` with `newBlocks` as tracked suggestions. */
export function suggestBlocks(oldBlocks: Block[], newBlocks: Block[], meta: SuggestionMeta = {}): Block[] {
  const ok = oldBlocks.map((b) => contentKey(b))
  const nk = newBlocks.map((b) => contentKey(b))
  const out: Block[] = []
  let i = 0
  let j = 0
  while (i < oldBlocks.length || j < newBlocks.length) {
    const o = oldBlocks[i]
    const n = newBlocks[j]
    if (o && n && ok[i] === nk[j]) {
      out.push(o)
      i++
      j++
      continue
    }
    // does the new block appear later in old (old ones deleted) or the old one later in new (new ones inserted)?
    const oldLater = n ? ok.indexOf(nk[j], i + 1) : -1
    const newLater = o ? nk.indexOf(ok[i], j + 1) : -1
    if (!n) {
      out.push(wrap("delete", [o], meta))
      i++
    } else if (!o) {
      out.push(wrap("insert", [n], meta))
      j++
    } else if (newLater >= 0 && (oldLater < 0 || newLater - j <= oldLater - i)) {
      out.push(wrap("insert", [n], meta))
      j++
    } else if (oldLater >= 0) {
      out.push(wrap("delete", [o], meta))
      i++
    } else {
      out.push(...suggestPair(o, n, meta))
      i++
      j++
    }
  }
  // merge adjacent block suggestions of the same kind
  const merged: Block[] = []
  for (const b of out) {
    const prev = merged[merged.length - 1]
    if (b.type === "suggestion" && prev?.type === "suggestion" && prev.kind === b.kind && prev.note === b.note) {
      merged[merged.length - 1] = { ...prev, blocks: [...prev.blocks, ...b.blocks] }
    } else merged.push(b)
  }
  return merged
}

function suggestPair(o: Block, n: Block, meta: SuggestionMeta): Block[] {
  if (textBearing(o) && textBearing(n)) {
    return [{ ...n, id: o.id, content: diffInlines((o as { content: Inline[] }).content, (n as { content: Inline[] }).content, meta) } as Block]
  }
  if (o.type === "list" && n.type === "list" && o.items.length === n.items.length) {
    const items: ListItem[] = n.items.map((it, k) => ({ ...it, blocks: suggestBlocks(o.items[k].blocks, it.blocks, meta) }))
    return [{ ...n, id: o.id, items }]
  }
  if (
    o.type === "table" &&
    n.type === "table" &&
    o.rows.length === n.rows.length &&
    o.rows.every((r, k) => r.cells.length === n.rows[k].cells.length)
  ) {
    return [
      {
        ...n,
        id: o.id,
        rows: n.rows.map((r, k) => ({
          cells: r.cells.map((c, x) => ({ ...c, content: diffInlines(o.rows[k].cells[x].content, c.content, meta) })),
        })),
      },
    ]
  }
  if ((o.type === "blockquote" || o.type === "callout") && o.type === n.type) {
    return [{ ...n, id: o.id, blocks: suggestBlocks(o.blocks, (n as typeof o).blocks, meta) } as Block]
  }
  return [wrap("delete", [o], meta), wrap("insert", [n], meta)]
}

// ------------------------------------------------------------ resolve

/** Accept or reject one suggestion (inline or block level). */
export function resolveSuggestion(doc: Document, sid: string, accept: boolean): Document {
  return resolveWhere(doc, (id) => id === sid, accept)
}

export function resolveAll(doc: Document, accept: boolean, filter?: (s: SuggestionInfo) => boolean): Document {
  const ids = new Set(listSuggestions(doc).filter((s) => !filter || filter(s)).map((s) => s.sid))
  return resolveWhere(doc, (id) => ids.has(id), accept)
}

function resolveWhere(doc: Document, match: (sid: string) => boolean, accept: boolean): Document {
  let blocks = mapBlocks(doc.blocks, (b) => {
    if (b.type !== "suggestion" || !match(b.sid)) return b
    const keep = (b.kind === "insert") === accept
    return keep ? b.blocks : null
  })
  blocks = mapInlines(blocks, (content) =>
    content.flatMap((n) => {
      const ins = n.marks?.find((m) => m.type === "insertion" && match(m.id))
      const del = n.marks?.find((m) => m.type === "deletion" && match(m.id))
      if (ins) return accept ? [{ ...n, marks: n.marks!.filter((m) => m !== ins) } as Inline] : []
      if (del) return accept ? [] : [{ ...n, marks: n.marks!.filter((m) => m !== del) } as Inline]
      return [n]
    }),
  )
  // a paragraph emptied by accepting a deletion disappears
  blocks = mapBlocks(blocks, (b) => (b.type === "paragraph" && b.content.length === 0 && wasTouched(doc, b.id, match) ? null : b))
  return { ...doc, blocks }
}

function wasTouched(doc: Document, id: string, match: (sid: string) => boolean): boolean {
  let hit = false
  forEachInline(doc.blocks, (c) => {
    if (hit) return
    for (const n of c) if (n.marks?.some((m) => (m.type === "deletion" || m.type === "insertion") && match(m.id))) hit = true
  })
  void id
  return hit
}

export type SuggestionInfo = {
  sid: string
  kind: "insert" | "delete" | "replace"
  scope: "inline" | "block"
  author?: string
  note?: string
  inserted: string
  deleted: string
  /** top-level block containing it */
  blockId: string
}

export function listSuggestions(doc: Document): SuggestionInfo[] {
  const map = new Map<string, SuggestionInfo>()
  const order: string[] = []
  const visitBlocks = (blocks: Block[], top?: Block) => {
    for (const b of blocks) {
      const t = top ?? b
      if (b.type === "suggestion") {
        const txt = blocksText(b.blocks)
        if (!map.has(b.sid)) order.push(b.sid)
        map.set(b.sid, {
          sid: b.sid,
          kind: b.kind,
          scope: "block",
          author: b.author,
          note: b.note,
          inserted: b.kind === "insert" ? txt : "",
          deleted: b.kind === "delete" ? txt : "",
          blockId: t.id,
        })
      }
      forEachInline([b], (content) => {
        for (const n of content) {
          for (const m of n.marks ?? []) {
            if (m.type !== "insertion" && m.type !== "deletion") continue
            let s = map.get(m.id)
            if (!s) {
              order.push(m.id)
              s = { sid: m.id, kind: m.type === "insertion" ? "insert" : "delete", scope: "inline", author: m.author, note: m.note, inserted: "", deleted: "", blockId: t.id }
              map.set(m.id, s)
            }
            const txt = n.type === "text" ? n.text : n.type === "footnote" ? "[footnote]" : ""
            if (m.type === "insertion") s.inserted += txt
            else s.deleted += txt
            if (s.inserted && s.deleted) s.kind = "replace"
          }
        }
      })
      if (b.type === "suggestion" || b.type === "blockquote" || b.type === "callout" || b.type === "columns") {
        // nested content already covered by forEachInline for inline marks; recurse for nested block suggestions
        visitNested(b.blocks, t)
      } else if (b.type === "list") b.items.forEach((it) => visitNested(it.blocks, t))
    }
  }
  const visitNested = (blocks: Block[], top: Block) => {
    for (const b of blocks) {
      if (b.type === "suggestion" && !map.has(b.sid)) {
        order.push(b.sid)
        map.set(b.sid, { sid: b.sid, kind: b.kind, scope: "block", author: b.author, note: b.note, inserted: b.kind === "insert" ? blocksText(b.blocks) : "", deleted: b.kind === "delete" ? blocksText(b.blocks) : "", blockId: top.id })
      }
      if ("blocks" in b) visitNested(b.blocks, top)
      if (b.type === "list") b.items.forEach((it) => visitNested(it.blocks, top))
    }
  }
  visitBlocks(doc.blocks)
  return order.map((id) => map.get(id)!)
}

export function blocksText(blocks: Block[]): string {
  const parts: string[] = []
  for (const b of blocks) {
    if (b.type === "paragraph" || b.type === "heading") parts.push(inlineText(b.content, { deletions: true }))
    else if (b.type === "list") b.items.forEach((it) => parts.push(blocksText(it.blocks)))
    else if (b.type === "table") parts.push(b.rows.map((r) => r.cells.map((c) => inlineText(c.content)).join(" | ")).join("\n"))
    else if (b.type === "code") parts.push(b.text)
    else if (b.type === "chart") parts.push(`[chart: ${b.title ?? b.chart}]`)
    else if (b.type === "image") parts.push(`[image: ${b.alt ?? b.src}]`)
    else if ("blocks" in b) parts.push(blocksText(b.blocks))
  }
  return parts.join("\n")
}

// ------------------------------------------------------------ comments

export type CommentInfo = { id: string; thread: CommentMessage[]; quote: string; blockId: string }

export function listComments(doc: Document): CommentInfo[] {
  const map = new Map<string, CommentInfo>()
  forEachInline(doc.blocks, (content, top) => {
    for (const n of content) {
      const m = n.marks?.find((x) => x.type === "comment") as Extract<Mark, { type: "comment" }> | undefined
      if (!m) continue
      const c = map.get(m.id) ?? { id: m.id, thread: m.thread, quote: "", blockId: top.id }
      if (n.type === "text") c.quote += n.text
      map.set(m.id, c)
    }
  })
  return [...map.values()]
}

/** Apply a mark to the character range [from, to) of inline content's plain text. */
export function markRange(content: Inline[], from: number, to: number, mark: Mark): Inline[] {
  const out: Inline[] = []
  let pos = 0
  for (const n of content) {
    const len = n.type === "text" ? n.text.length : 1
    const a = pos
    const b = pos + len
    pos = b
    if (b <= from || a >= to) {
      out.push(n)
      continue
    }
    if (n.type !== "text") {
      out.push(addMark(n, mark))
      continue
    }
    const s = Math.max(from, a) - a
    const e = Math.min(to, b) - a
    if (s > 0) out.push({ ...n, text: n.text.slice(0, s) })
    out.push(addMark({ ...n, text: n.text.slice(s, e) }, mark))
    if (e < n.text.length) out.push({ ...n, text: n.text.slice(e) })
  }
  return normalizeInlines(out)
}

function plainLen(content: Inline[]): string {
  return content.map((n) => (n.type === "text" ? n.text : "\u0001")).join("")
}

/** Anchor a new comment on the first occurrence of `quote` in a block (or the whole block). */
export function addComment(doc: Document, blockId: string, quote: string | undefined, msg: CommentMessage): { doc: Document; id: string | null } {
  const id = newId("c")
  let done = false
  const blocks = doc.blocks.map((top) => {
    if (top.id !== blockId) return top
    const [res] = mapInlines([top], (content) => {
      if (done) return content
      const txt = plainLen(content)
      const at = quote ? txt.indexOf(quote) : 0
      if (at < 0) return content
      done = true
      return markRange(content, at, quote ? at + quote.length : txt.length, { type: "comment", id, thread: [msg] })
    })
    return res
  })
  return { doc: { ...doc, blocks }, id: done ? id : null }
}

function updateComment(doc: Document, id: string, fn: (m: Extract<Mark, { type: "comment" }>) => Mark | null): Document {
  return {
    ...doc,
    blocks: mapInlines(doc.blocks, (content) =>
      content.map((n) => {
        const m = n.marks?.find((x) => x.type === "comment" && x.id === id) as Extract<Mark, { type: "comment" }> | undefined
        if (!m) return n
        const r = fn(m)
        return { ...n, marks: n.marks!.flatMap((x) => (x === m ? (r ? [r] : []) : [x])) } as Inline
      }),
    ),
  }
}

export function replyToComment(doc: Document, id: string, msg: CommentMessage): Document {
  return updateComment(doc, id, (m) => ({ ...m, thread: [...m.thread, msg] }))
}

export function resolveComment(doc: Document, id: string): Document {
  return updateComment(doc, id, () => null)
}

export { markEq }
