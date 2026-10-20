import { parse as parseYaml } from "yaml"
import { newId, reconcileIds } from "./ids"
import { createInlineContext, parseInline, type InlineContext } from "./inline"
import type {
  Align,
  Block,
  CalloutVariant,
  Chart,
  ChartType,
  DocMeta,
  Document,
  List,
  ListItem,
  TableRow,
} from "./model"

/** Where a top-level block lives in the source text (character offsets). */
export type BlockSource = { id: string; from: number; to: number }

export type ParseResult = {
  doc: Document
  /** source ranges of top-level blocks, in order */
  sources: BlockSource[]
  frontMatter?: { from: number; to: number }
  errors: { message: string; from: number }[]
}

type Line = { text: string; offset: number }

const RE = {
  fence: /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*(.*)$/,
  container: /^ {0,3}(:{3,})\s*([\w-]+)(?:\[(.*?)\])?\s*(?:\{(.*)\})?\s*(.*)$/,
  containerEnd: /^ {0,3}:{3,}\s*$/,
  leaf: /^ {0,3}::([\w-]+)(?:\[(.*?)\])?(?:\{(.*)\})?\s*$/,
  heading: /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/,
  hr: /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
  image: /^ {0,3}!\[(.*?)\]\((.*?)\)\s*(?:\{([^}]*)\})?\s*$/,
  tableDelim: /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/,
  quote: /^ {0,3}> ?/,
  list: /^( *)([-*+]|\d{1,9}[.)])(?:( +)(?:\[([ xX])\] +)?(.*))?$/,
  footDef: /^\[\^([^\]]+)\]:\s?(.*)$/,
  caption: /^Table:\s*(.*)$/,
}

const blank = (l: Line | undefined) => !l || l.text.trim() === ""

/** Parse attribute lists like `#anchor .center count=2 by=claude note="a b"`. */
export function parseAttrs(src = ""): { id?: string; classes: string[]; kv: Record<string, string> } {
  const out: { id?: string; classes: string[]; kv: Record<string, string> } = { classes: [], kv: {} }
  const re = /([#.][\w:-]+)|([\w-]+)=(?:"((?:[^"\\]|\\.)*)"|([^\s"]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[1]?.startsWith("#")) out.id = m[1].slice(1)
    else if (m[1]) out.classes.push(m[1].slice(1))
    else out.kv[m[2]] = m[3] !== undefined ? m[3].replace(/\\"/g, '"') : m[4]
  }
  return out
}

const ALIGNS = ["left", "center", "right", "justify"]
const alignOf = (classes: string[]) => classes.find((c) => ALIGNS.includes(c)) as Align | undefined

function startsBlock(lines: Line[], i: number): boolean {
  const t = lines[i].text
  return (
    RE.fence.test(t) ||
    RE.container.test(t) ||
    RE.containerEnd.test(t) ||
    RE.leaf.test(t) ||
    /^ {0,3}#{1,6}(\s|$)/.test(t) ||
    RE.hr.test(t) ||
    RE.quote.test(t) ||
    /^ {0,3}([-*+]|1[.)]) /.test(t) ||
    (t.includes("|") && !!lines[i + 1] && RE.tableDelim.test(lines[i + 1].text) && lines[i + 1].text.includes("-"))
  )
}

function splitRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith("|")) t = t.slice(1)
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1)
  const cells: string[] = []
  let cur = ""
  let code = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === "\\" && t[i + 1] === "|") {
      cur += "|"
      i++
    } else if (c === "`") {
      code = !code
      cur += c
    } else if (c === "|" && !code) {
      cells.push(cur.trim())
      cur = ""
    } else cur += c
  }
  cells.push(cur.trim())
  return cells
}

function parseCsv(src: string): string[][] {
  const rows: string[][] = []
  for (const line of src.split("\n")) {
    if (!line.trim()) continue
    const row: string[] = []
    let cur = ""
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (c === '"') q = false
        else cur += c
      } else if (c === '"') q = true
      else if (c === ",") {
        row.push(cur.trim())
        cur = ""
      } else cur += c
    }
    row.push(cur.trim())
    rows.push(row)
  }
  return rows
}

const num = (v: string): string | number => (v !== "" && !isNaN(Number(v)) ? Number(v) : v)

export function parseChart(body: string, id: string): Chart {
  const sep = body.split("\n").findIndex((l) => l.trim() === "---")
  const head = sep >= 0 ? body.split("\n").slice(0, sep).join("\n") : ""
  const csv = sep >= 0 ? body.split("\n").slice(sep + 1).join("\n") : body
  const conf: Record<string, string> = {}
  for (const l of head.split("\n")) {
    const m = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(l)
    if (m) conf[m[1]] = m[2].trim()
  }
  const rows = parseCsv(csv)
  const cols = rows[0] ?? []
  const data = rows.slice(1).map((r) => Object.fromEntries(cols.map((c, i) => [c, num(r[i] ?? "")])))
  const x = conf.x || cols[0] || "x"
  const y = conf.y
    ? conf.y.split(",").map((s) => s.trim()).filter(Boolean)
    : cols.filter((c) => c !== x && data.some((d) => typeof d[c] === "number"))
  const type = (conf.type || conf.chart || "bar") as ChartType
  const chart: Chart = { id, type: "chart", chart: ["bar", "line", "area", "pie"].includes(type) ? type : "bar", x, y, data }
  if (conf.title) chart.title = conf.title
  if (conf.caption) chart.caption = conf.caption
  if (conf.stacked === "true") chart.stacked = true
  return chart
}

const CALLOUTS: Record<string, CalloutVariant> = {
  note: "note",
  info: "note",
  tip: "tip",
  warning: "warning",
  caution: "warning",
  danger: "danger",
  important: "danger",
}

type Parsed = { block: Block; from: number; to: number }

function parseBlocks(lines: Line[], ctx: InlineContext, errors: ParseResult["errors"]): Parsed[] {
  const out: Parsed[] = []
  let i = 0
  const push = (block: Block, a: number, b: number) =>
    out.push({ block, from: lines[a].offset, to: lines[b].offset + lines[b].text.length })

  while (i < lines.length) {
    const line = lines[i]
    const t = line.text
    if (blank(line)) {
      i++
      continue
    }

    // fenced code / chart
    let m = RE.fence.exec(t)
    if (m) {
      const fence = m[1]
      const lang = m[2]
      const start = i
      const body: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(lines[i].text)) {
        body.push(lines[i].text)
        i++
      }
      const end = Math.min(i, lines.length - 1)
      if (i >= lines.length) errors.push({ message: "Unclosed code fence", from: lines[start].offset })
      i++
      if (lang === "chart") push(parseChart(body.join("\n"), newId()), start, end)
      else push({ id: newId(), type: "code", text: body.join("\n"), ...(lang ? { lang } : {}) }, start, end)
      continue
    }

    // container directive :::name[label]{attrs}
    m = RE.container.exec(t)
    if (m && !RE.containerEnd.test(t)) {
      const start = i
      const name = m[2].toLowerCase()
      const label = m[3] ?? (m[5] || undefined)
      const attrs = parseAttrs(m[4])
      let depth = 1
      const inner: Line[] = []
      i++
      while (i < lines.length) {
        const lt = lines[i].text
        if (RE.containerEnd.test(lt)) {
          depth--
          if (depth === 0) break
        } else if (RE.container.test(lt)) depth++
        inner.push(lines[i])
        i++
      }
      if (i >= lines.length) errors.push({ message: `Unclosed :::${name}`, from: lines[start].offset })
      const end = Math.min(i, lines.length - 1)
      i++
      const blocks = parseBlocks(inner, ctx, errors).map((p) => p.block)
      if (name === "columns") {
        push({ id: newId(), type: "columns", count: Number(attrs.kv.count ?? label ?? 2) || 2, blocks }, start, end)
      } else if (name === "suggest" || name === "suggestion") {
        push(
          {
            id: newId(),
            type: "suggestion",
            kind: attrs.kv.type === "delete" ? "delete" : "insert",
            sid: ctx.nextSuggestionId(),
            ...(attrs.kv.by ? { author: attrs.kv.by } : {}),
            ...(attrs.kv.note ? { note: attrs.kv.note } : {}),
            blocks,
          },
          start,
          end,
        )
      } else if (name === "quote" || name === "blockquote") {
        push({ id: newId(), type: "blockquote", blocks }, start, end)
      } else {
        const variant = CALLOUTS[name] ?? "note"
        push({ id: newId(), type: "callout", variant, ...(label ? { title: label } : {}), blocks }, start, end)
      }
      continue
    }
    if (RE.containerEnd.test(t)) {
      errors.push({ message: "Unmatched :::", from: line.offset })
      i++
      continue
    }

    // leaf directive ::name
    m = RE.leaf.exec(t)
    if (m) {
      const name = m[1].toLowerCase()
      const attrs = parseAttrs(m[3])
      if (name === "pagebreak" || name === "newpage") push({ id: newId(), type: "pagebreak" }, i, i)
      else if (name === "toc")
        push({ id: newId(), type: "toc", ...(m[2] ? { title: m[2] } : {}), ...(attrs.kv.depth ? { depth: Number(attrs.kv.depth) } : {}) }, i, i)
      else if (name === "references" || name === "bibliography")
        push({ id: newId(), type: "references", ...(m[2] ? { title: m[2] } : {}) }, i, i)
      else errors.push({ message: `Unknown directive ::${name}`, from: line.offset })
      i++
      continue
    }

    // heading
    m = RE.heading.exec(t)
    if (m) {
      let body = (m[2] ?? "").replace(/\s+#+\s*$/, "")
      const am = /\s*\{([^{}]*)\}\s*$/.exec(body)
      let anchor: string | undefined
      let align: Align | undefined
      if (am && /^\s*([#.][\w-]+\s*)+$/.test(am[1])) {
        const a = parseAttrs(am[1])
        anchor = a.id
        align = alignOf(a.classes)
        body = body.slice(0, am.index)
      }
      push(
        {
          id: newId(),
          type: "heading",
          level: m[1].length as 1,
          content: parseInline(body, ctx),
          ...(anchor ? { anchor } : {}),
          ...(align ? { align } : {}),
        },
        i,
        i,
      )
      i++
      continue
    }

    if (RE.hr.test(t)) {
      push({ id: newId(), type: "divider" }, i, i)
      i++
      continue
    }

    m = RE.image.exec(t)
    if (m) {
      let src = m[2].trim()
      let caption: string | undefined
      const tm = /^(\S+)\s+"(.*)"$/.exec(src)
      if (tm) {
        src = tm[1]
        caption = tm[2]
      }
      const attrs = parseAttrs(m[3])
      push(
        {
          id: newId(),
          type: "image",
          src: src.replace(/^<|>$/g, ""),
          ...(m[1] ? { alt: m[1] } : {}),
          ...(caption ? { caption } : {}),
          ...(attrs.kv.width ? { width: attrs.kv.width } : {}),
        },
        i,
        i,
      )
      i++
      continue
    }

    // table
    if (t.includes("|") && lines[i + 1] && RE.tableDelim.test(lines[i + 1].text) && lines[i + 1].text.includes("-")) {
      const start = i
      const head = splitRow(t)
      const aligns = splitRow(lines[i + 1].text).map((d): Align | undefined => {
        const l = d.startsWith(":")
        const r = d.endsWith(":")
        return l && r ? "center" : r ? "right" : l ? "left" : undefined
      })
      i += 2
      const body: string[][] = []
      while (i < lines.length && !blank(lines[i]) && lines[i].text.includes("|")) {
        body.push(splitRow(lines[i].text))
        i++
      }
      let end = i - 1
      let caption: string | undefined
      const capLine = blank(lines[i]) && lines[i + 1] && RE.caption.test(lines[i + 1].text) ? i + 1 : lines[i] && RE.caption.test(lines[i].text) ? i : -1
      if (capLine >= 0) {
        caption = RE.caption.exec(lines[capLine].text)![1]
        end = capLine
        i = capLine + 1
      }
      const width = head.length
      const toRow = (cells: string[]): TableRow => ({
        cells: Array.from({ length: width }, (_, c) => ({
          content: parseInline(cells[c] ?? "", ctx),
          ...(aligns[c] ? { align: aligns[c] } : {}),
        })),
      })
      const headerEmpty = head.every((h) => h === "")
      const rows = [...(headerEmpty ? [] : [toRow(head)]), ...body.map(toRow)]
      push({ id: newId(), type: "table", header: !headerEmpty, rows, ...(caption ? { caption } : {}) }, start, end)
      continue
    }

    // blockquote
    if (RE.quote.test(t)) {
      const start = i
      const inner: Line[] = []
      while (i < lines.length && RE.quote.test(lines[i].text)) {
        const strip = RE.quote.exec(lines[i].text)![0].length
        inner.push({ text: lines[i].text.slice(strip), offset: lines[i].offset + strip })
        i++
      }
      push({ id: newId(), type: "blockquote", blocks: parseBlocks(inner, ctx, errors).map((p) => p.block) }, start, i - 1)
      continue
    }

    // list
    m = RE.list.exec(t)
    if (m && (m[3] !== undefined || m[5] === undefined)) {
      const start = i
      const indent = m[1].length
      const ordered = /\d/.test(m[2])
      const delim = m[2].slice(-1)
      const items: { lines: Line[]; checked?: boolean }[] = []
      let task = m[4] !== undefined
      let last = i
      while (i < lines.length) {
        const lm = RE.list.exec(lines[i].text)
        if (!lm || lm[1].length !== indent || /\d/.test(lm[2]) !== ordered || lm[2].slice(-1) !== delim) break
        const contentIndent = indent + lm[2].length + (lm[3]?.length ?? 1)
        const firstOffset = lines[i].text.length - (lm[5] ?? "").length
        const itemLines: Line[] = [{ text: lm[5] ?? "", offset: lines[i].offset + firstOffset }]
        const checked = lm[4] !== undefined ? lm[4] !== " " : undefined
        if (items.length === 0) task = lm[4] !== undefined
        last = i
        i++
        while (i < lines.length) {
          const lt = lines[i].text
          if (blank(lines[i])) {
            // blank line: continue only if next non-blank line is indented into the item
            let j = i
            while (j < lines.length && blank(lines[j])) j++
            if (j < lines.length && /^ */.exec(lines[j].text)![0].length >= contentIndent) {
              for (; i < j; i++) itemLines.push({ text: "", offset: lines[i].offset })
              continue
            }
            break
          }
          const ind = /^ */.exec(lt)![0].length
          if (ind >= contentIndent) {
            itemLines.push({ text: lt.slice(contentIndent), offset: lines[i].offset + contentIndent })
          } else if (!RE.list.test(lt) && !startsBlock(lines, i) && !blank(lines[i - 1])) {
            itemLines.push({ text: lt.trimStart(), offset: lines[i].offset + ind }) // lazy continuation
          } else break
          last = i
          i++
        }
        items.push({ lines: itemLines, checked })
      }
      const listItems: ListItem[] = items.map((it) => {
        const blocks = parseBlocks(it.lines, ctx, errors).map((p) => p.block)
        return {
          blocks: blocks.length ? blocks : [{ id: newId(), type: "paragraph", content: [] }],
          ...(task ? { checked: !!it.checked } : {}),
        }
      })
      const list: List = { id: newId(), type: "list", kind: task ? "task" : ordered ? "ordered" : "bullet", items: listItems }
      const startNum = ordered ? parseInt(m[2], 10) : 1
      if (ordered && startNum !== 1) list.start = startNum
      push(list, start, last)
      // skip trailing blank lines consumed
      continue
    }

    // paragraph
    const start = i
    const buf: string[] = [t.trimStart()]
    i++
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines, i)) {
      buf.push(lines[i].text.trimStart())
      i++
    }
    let body = buf.join("\n")
    let align: Align | undefined
    const am = /\s*\{\.(left|center|right|justify)\}\s*$/.exec(body)
    if (am) {
      align = am[1] as Align
      body = body.slice(0, am.index)
    }
    push({ id: newId(), type: "paragraph", content: parseInline(body, ctx), ...(align ? { align } : {}) }, start, i - 1)
  }
  return out
}

/**
 * Parse word2 source (markdown-flavoured, see README) into a document.
 * Pass the previous document to carry block ids over unchanged blocks.
 * The parser never throws: malformed input degrades to paragraphs and is reported in `errors`.
 */
export function parse(src: string, prev?: Document): ParseResult {
  const errors: ParseResult["errors"] = []
  const raw = src.replace(/\r\n?/g, "\n")
  let lines: Line[] = []
  let off = 0
  for (const text of raw.split("\n")) {
    lines.push({ text, offset: off })
    off += text.length + 1
  }

  let meta: DocMeta = {}
  let frontMatter: ParseResult["frontMatter"]
  if (lines[0]?.text.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && (l.text.trim() === "---" || l.text.trim() === "..."))
    if (end > 0) {
      const yamlSrc = lines.slice(1, end).map((l) => l.text).join("\n")
      try {
        const v = parseYaml(yamlSrc)
        if (v && typeof v === "object") meta = v as DocMeta
      } catch (e) {
        errors.push({ message: `Front matter: ${(e as Error).message.split("\n")[0]}`, from: 0 })
      }
      frontMatter = { from: 0, to: lines[end].offset + lines[end].text.length }
      lines = lines.map((l, i) => (i <= end ? { ...l, text: "" } : l))
    }
  }

  // footnote definitions: [^label]: text (+ indented continuation lines)
  const footnotes = new Map<string, string>()
  for (let i = 0; i < lines.length; i++) {
    const m = RE.footDef.exec(lines[i].text)
    if (!m) continue
    const parts = [m[2]]
    lines[i] = { ...lines[i], text: "" }
    while (i + 1 < lines.length && /^ {2,}\S/.test(lines[i + 1].text)) {
      parts.push(lines[i + 1].text.trim())
      lines[i + 1] = { ...lines[i + 1], text: "" }
      i++
    }
    footnotes.set(m[1], parts.join(" "))
  }

  const ctx = createInlineContext(footnotes)
  const parsed = parseBlocks(lines, ctx, errors)
  let blocks = parsed.map((p) => p.block)
  if (prev) blocks = reconcileIds(prev.blocks, blocks)
  return {
    doc: { meta, blocks },
    sources: parsed.map((p, i) => ({ id: blocks[i].id, from: p.from, to: p.to })),
    frontMatter,
    errors,
  }
}
