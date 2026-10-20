import type { CommentMessage, Inline, Mark, MarkType, TextNode } from "./model"

/**
 * Inline syntax (markdown-flavoured, with CriticMarkup for review):
 *
 *   **bold**  *italic*  ~~strike~~  ==highlight==  `code`  ^sup^  ~sub~
 *   [text](https://link "title")   [text]{.underline .smallcaps color=#c00}
 *   ^[inline footnote]   [^label] (+ `[^label]: text` definition)   [@key, p. 4; @other]
 *   {++inserted++}  {--deleted--}  {~~old~>new~~}  {==commented==}{>>@alex: text<<}
 *   a comment right after a change is that change's author + note: {++x++}{>>@claude: why<<}
 *   line break: backslash at end of line (or <br> in table cells)
 */

export const MARK_ORDER: MarkType[] = [
  "link",
  "comment",
  "deletion",
  "insertion",
  "underline",
  "smallcaps",
  "color",
  "bold",
  "italic",
  "strike",
  "highlight",
  "sup",
  "sub",
  "code",
]

export function sortMarks(marks: Mark[]): Mark[] {
  return marks.slice().sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type))
}

export function markEq(a: Mark, b: Mark): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function marksEq(a: Mark[] = [], b: Mark[] = []): boolean {
  if (a.length !== b.length) return false
  const sa = sortMarks(a)
  const sb = sortMarks(b)
  return sa.every((m, i) => markEq(m, sb[i]))
}

export function hasMark(n: Inline, type: MarkType): boolean {
  return !!n.marks?.some((m) => m.type === type)
}

/** Merge adjacent text nodes with identical marks and drop empty ones. */
export function normalizeInlines(nodes: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const n of nodes) {
    if (n.type === "text" && n.text === "") continue
    const prev = out[out.length - 1]
    if (n.type === "text" && prev?.type === "text" && marksEq(prev.marks, n.marks)) {
      out[out.length - 1] = { ...prev, text: prev.text + n.text }
    } else {
      const c = { ...n } as Inline
      if (c.marks && c.marks.length === 0) delete c.marks
      else if (c.marks) c.marks = sortMarks(c.marks)
      out.push(c)
    }
  }
  return out
}

export type InlineContext = {
  nextSuggestionId: () => string
  nextCommentId: () => string
  footnotes: Map<string, string>
}

export function createInlineContext(footnotes = new Map<string, string>()): InlineContext {
  let s = 0
  let c = 0
  return {
    nextSuggestionId: () => `s${++s}`,
    nextCommentId: () => `c${++c}`,
    footnotes,
  }
}

const PUNCT = /[!-/:-@[-`{-~]/
const isAlnum = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)

type Toggle = "bold" | "italic" | "strike" | "highlight" | "sup" | "sub"

/** Index of the bracket closing the one at `open`, honouring nesting and escapes. */
function matchBracket(s: string, open: number, o = "[", c = "]"): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const ch = s[i]
    if (ch === "\\") {
      i++
      continue
    }
    if (ch === "`") {
      const run = runLength(s, i, "`")
      const close = s.indexOf("`".repeat(run), i + run)
      if (close > 0) {
        i = close + run - 1
        continue
      }
    }
    if (ch === o) depth++
    else if (ch === c) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function runLength(s: string, i: number, ch: string): number {
  let n = 0
  while (s[i + n] === ch) n++
  return n
}

/** Find the next unescaped occurrence of `token` at or after `from`. */
function findToken(s: string, token: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\") {
      i++
      continue
    }
    if (s.startsWith(token, i)) return i
  }
  return -1
}

function hasCloser(s: string, from: number, ch: string, len: number): boolean {
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (c === "\\") {
      i++
      continue
    }
    if (c === "`") {
      const run = runLength(s, i, "`")
      const close = s.indexOf("`".repeat(run), i + run)
      if (close > 0) i = close + run - 1
      continue
    }
    if ((ch === "~" || ch === "^") && len === 1 && /\s/.test(c)) return false
    if (c === ch) {
      const run = runLength(s, i, ch)
      if (run >= len && !/\s/.test(s[i - 1] ?? " ") && (ch !== "_" || !isAlnum(s[i + run]))) return true
      i += run - 1
    }
  }
  return false
}

function parseComment(body: string): CommentMessage {
  const m = /^@([\w.-]+):?\s*/.exec(body)
  return m ? { author: m[1], text: body.slice(m[0].length) } : { author: "", text: body }
}

/** Parse a run of `{>>...<<}` comments starting at i. */
function readComments(s: string, i: number): { msgs: CommentMessage[]; end: number } {
  const msgs: CommentMessage[] = []
  let p = i
  while (s.startsWith("{>>", p)) {
    const close = s.indexOf("<<}", p + 3)
    if (close < 0) break
    msgs.push(parseComment(s.slice(p + 3, close)))
    p = close + 3
  }
  return { msgs, end: p }
}

function spanMarks(attrs: string): Mark[] {
  const marks: Mark[] = []
  for (const tok of attrs.trim().split(/\s+/)) {
    const cls = tok.startsWith(".") ? tok.slice(1) : null
    if (cls === "underline" || cls === "u") marks.push({ type: "underline" })
    else if (cls === "smallcaps") marks.push({ type: "smallcaps" })
    else if (cls === "bold") marks.push({ type: "bold" })
    else if (cls === "italic") marks.push({ type: "italic" })
    else if (cls === "strike") marks.push({ type: "strike" })
    else if (cls === "mark" || cls === "highlight") marks.push({ type: "highlight" })
    else if (cls === "sup") marks.push({ type: "sup" })
    else if (cls === "sub") marks.push({ type: "sub" })
    else if (cls === "code") marks.push({ type: "code" })
    else if (tok.startsWith("color=")) marks.push({ type: "color", color: tok.slice(6).replace(/^["']|["']$/g, "") })
  }
  return marks
}

function annotate(nodes: Inline[], type: "insertion" | "deletion", id: string, msg?: CommentMessage) {
  for (const n of nodes) {
    for (const m of n.marks ?? []) {
      if (m.type === type && m.id === id && msg) {
        if (msg.author) m.author = msg.author
        if (msg.text) m.note = msg.text
      }
    }
  }
}

export function parseInline(src: string, ctx: InlineContext = createInlineContext(), base: Mark[] = []): Inline[] {
  const out: Inline[] = []
  const active: Toggle[] = []
  let buf = ""
  const marks = (): Mark[] => [...base, ...active.map((t) => ({ type: t }) as Mark)]
  const flush = () => {
    if (buf) out.push({ type: "text", text: buf, marks: marks() })
    buf = ""
  }
  const s = src
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "\\") {
      const n = s[i + 1]
      if (n === "\n") {
        flush()
        out.push({ type: "break", marks: marks() })
        i += 2
        continue
      }
      if (n !== undefined && PUNCT.test(n)) {
        buf += n
        i += 2
        continue
      }
      buf += c
      i++
      continue
    }
    if (c === "\n") {
      if (buf.endsWith("  ")) {
        buf = buf.trimEnd()
        flush()
        out.push({ type: "break", marks: marks() })
      } else buf += " "
      i++
      continue
    }
    if (c === "<" && /^<br\s*\/?>/i.test(s.slice(i, i + 6))) {
      flush()
      out.push({ type: "break", marks: marks() })
      i += /^<br\s*\/?>/i.exec(s.slice(i, i + 6))![0].length
      continue
    }
    if (c === "`") {
      const run = runLength(s, i, "`")
      const close = s.indexOf("`".repeat(run), i + run)
      if (close > 0) {
        flush()
        let code = s.slice(i + run, close)
        if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1)
        out.push({ type: "text", text: code, marks: [...marks(), { type: "code" }] })
        i = close + run
        continue
      }
      buf += "`".repeat(run)
      i += run
      continue
    }
    if (c === "{") {
      const op = s.slice(i, i + 3)
      const closer = { "{++": "++}", "{--": "--}", "{~~": "~~}", "{==": "==}", "{>>": "<<}" }[op]
      const close = closer ? findToken(s, closer, i + 3) : -1
      if (closer && close >= 0) {
        flush()
        const body = s.slice(i + 3, close)
        let end = close + 3
        if (op === "{++" || op === "{--") {
          const type = op === "{++" ? "insertion" : "deletion"
          const id = ctx.nextSuggestionId()
          const nodes = parseInline(body, ctx, [...marks(), { type, id }])
          const { msgs, end: e2 } = readComments(s, end)
          if (msgs.length) {
            annotate(nodes, type, id, msgs[0])
            end = e2
          }
          out.push(...nodes)
        } else if (op === "{~~") {
          const split = findToken(body, "~>", 0)
          const oldText = split >= 0 ? body.slice(0, split) : body
          const newText = split >= 0 ? body.slice(split + 2) : ""
          const id = ctx.nextSuggestionId()
          const del = parseInline(oldText, ctx, [...marks(), { type: "deletion", id }])
          const ins = parseInline(newText, ctx, [...marks(), { type: "insertion", id }])
          const { msgs, end: e2 } = readComments(s, end)
          if (msgs.length) {
            annotate(del, "deletion", id, msgs[0])
            annotate(ins, "insertion", id, msgs[0])
            end = e2
          }
          out.push(...del, ...ins)
        } else if (op === "{==") {
          const { msgs, end: e2 } = readComments(s, end)
          if (msgs.length) {
            const id = ctx.nextCommentId()
            out.push(...parseInline(body, ctx, [...marks(), { type: "comment", id, thread: msgs }]))
            end = e2
          } else out.push(...parseInline(body, ctx, [...marks(), { type: "highlight" }]))
        } else {
          // standalone comment: anchor it on the previous word
          const { msgs, end: e2 } = readComments(s, i)
          end = e2
          const id = ctx.nextCommentId()
          const prev = out[out.length - 1]
          if (prev && prev.type === "text") {
            const m = /(\S+\s*)$/.exec(prev.text)
            const word = m ? m[1] : prev.text
            const rest = prev.text.slice(0, prev.text.length - word.length)
            out.pop()
            if (rest) out.push({ ...prev, text: rest })
            out.push({ ...prev, text: word, marks: [...(prev.marks ?? []), { type: "comment", id, thread: msgs }] })
          } else {
            out.push({ type: "text", text: "¶", marks: [...marks(), { type: "comment", id, thread: msgs }] })
          }
        }
        i = end
        continue
      }
    }
    if (c === "^" && s[i + 1] === "[") {
      const close = matchBracket(s, i + 1)
      if (close > 0) {
        flush()
        out.push({ type: "footnote", content: parseInline(s.slice(i + 2, close), ctx), ...(marks().length ? { marks: marks() } : {}) })
        i = close + 1
        continue
      }
    }
    if (c === "[") {
      const close = matchBracket(s, i)
      if (close > 0) {
        const inner = s.slice(i + 1, close)
        if (inner.startsWith("^")) {
          const def = ctx.footnotes.get(inner.slice(1))
          if (def !== undefined) {
            flush()
            out.push({ type: "footnote", content: parseInline(def, ctx) })
            i = close + 1
            continue
          }
        } else if (/^-?@[\w:.#$%&+?<>~/-]+/.test(inner)) {
          flush()
          const keys: string[] = []
          let locator: string | undefined
          for (const part of inner.split(";")) {
            const m = /^\s*-?@([\w:.#$%&+?<>~/-]+?)(?:,\s*(.*))?\s*$/.exec(part)
            if (m) {
              keys.push(m[1])
              if (m[2]) locator = m[2]
            }
          }
          out.push({ type: "cite", keys, ...(locator ? { locator } : {}) })
          i = close + 1
          continue
        } else if (s[close + 1] === "(") {
          const pclose = matchBracket(s, close + 1, "(", ")")
          if (pclose > 0) {
            flush()
            let target = s.slice(close + 2, pclose).trim()
            let title: string | undefined
            const tm = /^(.*?)\s+"(.*)"$/.exec(target)
            if (tm) {
              target = tm[1]
              title = tm[2]
            }
            if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1)
            const link: Mark = title ? { type: "link", href: target, title } : { type: "link", href: target }
            out.push(...parseInline(inner, ctx, [...marks(), link]))
            i = pclose + 1
            continue
          }
        } else if (s[close + 1] === "{") {
          const bclose = s.indexOf("}", close + 2)
          if (bclose > 0) {
            flush()
            out.push(...parseInline(inner, ctx, [...marks(), ...spanMarks(s.slice(close + 2, bclose))]))
            i = bclose + 1
            continue
          }
        }
      }
    }
    if (c === "*" || c === "_" || c === "~" || c === "^" || c === "=") {
      const run = runLength(s, i, c)
      let toggles: Toggle[] = []
      if (c === "*" || c === "_") {
        if (c === "_") {
          const before = s[i - 1]
          const after = s[i + run]
          const opening = !active.includes(run >= 2 ? "bold" : "italic")
          if ((opening && isAlnum(before)) || (!opening && isAlnum(after))) {
            buf += c.repeat(run)
            i += run
            continue
          }
        }
        toggles = run >= 3 ? ["bold", "italic"] : run === 2 ? ["bold"] : ["italic"]
      } else if (c === "~") toggles = run === 2 ? ["strike"] : run === 1 ? ["sub"] : []
      else if (c === "^") toggles = run === 1 ? ["sup"] : []
      else if (c === "=") toggles = run === 2 ? ["highlight"] : []
      const used = Math.min(run, c === "*" || c === "_" ? 3 : run)
      let consumed = false
      const prevWs = /\s/.test(s[i - 1] ?? " ")
      const nextWs = /\s/.test(s[i + run] ?? " ")
      for (const t of toggles) {
        const len = t === "bold" || t === "strike" || t === "highlight" ? 2 : 1
        if (active.includes(t) && !prevWs) {
          flush()
          active.splice(active.lastIndexOf(t), 1)
          consumed = true
        } else if (!active.includes(t) && !nextWs && hasCloser(s, i + used, c, len)) {
          flush()
          active.push(t)
          consumed = true
        }
      }
      if (!consumed) buf += c.repeat(run)
      else if (run > used) buf += c.repeat(run - used)
      i += run
      continue
    }
    buf += c
    i++
  }
  flush()
  return normalizeInlines(out)
}

// ---------------------------------------------------------------- serialize

type SerOpts = { inBracket?: boolean; table?: boolean }

export function escapeText(text: string, opts: SerOpts = {}): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    const prev = text[i - 1]
    if (c === "\\" || c === "*" || c === "`" || c === "~" || c === "^") out += "\\" + c
    else if (c === "_" && !(isAlnum(prev) && isAlnum(next))) out += "\\_"
    else if (c === "=" && (next === "=" || prev === "=")) out += "\\="
    else if (c === "[" && (opts.inBracket || /^\[[^\]]*\](\(|\{)|^\[[@^]/.test(text.slice(i)))) out += "\\["
    else if (c === "]" && opts.inBracket) out += "\\]"
    else if (c === "{" && /^\{(\+\+|--|~~|==|>>)/.test(text.slice(i))) out += "\\{"
    else if (c === "|" && opts.table) out += "\\|"
    else if (c === "<" && /^<br/i.test(text.slice(i))) out += "\\<"
    else if (c === "\n") out += " "
    else out += c
  }
  return out
}

function commentSrc(m: CommentMessage): string {
  const text = m.text.replace(/<<\}/g, "<< }").replace(/\n/g, " ")
  return `{>>${m.author ? `@${m.author}: ` : ""}${text}<<}`
}

function noteSrc(m: { author?: string; note?: string }): string {
  if (!m.author && !m.note) return ""
  return commentSrc({ author: m.author ?? "", text: m.note ?? "" })
}

function without(n: Inline, mark: Mark): Inline {
  const marks = (n.marks ?? []).filter((m) => !markEq(m, mark))
  return { ...n, marks } as Inline
}

const DELIMS: Partial<Record<MarkType, string>> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  highlight: "==",
}

function spanClass(m: Mark): string {
  switch (m.type) {
    case "color":
      return `color=${m.color}`
    case "highlight":
      return ".mark"
    default:
      return "." + m.type
  }
}

/** Serialize inline content back to source. Output always re-parses to the same content. */
export function serializeInline(nodes: Inline[], opts: SerOpts = {}): string {
  nodes = shedWhitespace(normalizeInlines(nodes))
  let out = ""
  let i = 0
  while (i < nodes.length) {
    const n = nodes[i]
    const ms = sortMarks(n.marks ?? [])
    if (ms.length === 0 || (ms.length === 1 && ms[0].type === "code" && n.type === "text")) {
      if (n.type === "text" && ms.length === 1) {
        const ticks = n.text.includes("`") ? "``" : "`"
        const pad = n.text.startsWith("`") || n.text.endsWith("`") ? " " : ""
        out += `${ticks}${pad}${n.text}${pad}${ticks}`
      } else out += atomSrc(n, opts)
      i++
      continue
    }
    // choose the outermost mark: the one spanning the longest run from here
    let best: Mark = ms[0]
    let bestLen = 0
    for (const m of ms) {
      let j = i
      while (j < nodes.length && (nodes[j].marks ?? []).some((x) => markEq(x, m))) j++
      if (j - i > bestLen) {
        best = m
        bestLen = j - i
      }
    }
    const run = nodes.slice(i, i + bestLen).map((x) => without(x, best))
    i += bestLen

    if (best.type === "deletion") {
      // substitution = deletion immediately followed by insertion with the same id
      let j = i
      const ins: Inline[] = []
      while (j < nodes.length && (nodes[j].marks ?? []).some((x) => x.type === "insertion" && x.id === best.id)) {
        const im = nodes[j].marks!.find((x) => x.type === "insertion" && x.id === best.id)!
        ins.push(without(nodes[j], im))
        j++
      }
      if (ins.length) {
        i = j
        out += `{~~${serializeInline(run, opts)}~>${serializeInline(ins, opts)}~~}${noteSrc(best)}`
      } else out += `{--${serializeInline(run, opts)}--}${noteSrc(best)}`
      continue
    }
    const inner = serializeInline(run, opts)
    switch (best.type) {
      case "insertion":
        out += `{++${inner}++}${noteSrc(best)}`
        break
      case "comment":
        out += `{==${inner}==}${best.thread.map(commentSrc).join("")}`
        break
      case "link": {
        const href = /[\s()<>]/.test(best.href) ? `<${best.href}>` : best.href
        const title = best.title ? ` "${best.title.replace(/"/g, "'")}"` : ""
        out += `[${serializeInline(run, { ...opts, inBracket: true })}](${href}${title})`
        break
      }
      case "code": {
        out += serializeInline([{ type: "text", text: run.map((r) => (r.type === "text" ? r.text : "")).join(""), marks: [best] }], opts)
        break
      }
      default: {
        const d = DELIMS[best.type]
        const plainNoSpace = run.every((r) => r.type === "text" && !r.marks?.length && !/\s/.test(r.text))
        const simpleSupSub = (best.type === "sup" || best.type === "sub") && plainNoSpace
        const last = out[out.length - 1]
        const first = inner[0]
        const ch = d?.[0] ?? (best.type === "sup" ? "^" : best.type === "sub" ? "~" : "")
        // avoid ambiguous delimiter runs (e.g. `***` + `*`): fall back to span syntax
        const clash = !!ch && (last === ch || first === ch || inner[inner.length - 1] === ch || first === undefined || /^\s|\s$/.test(inner))
        if (d && !clash) out += `${d}${inner}${d}`
        else if (simpleSupSub && !clash) out += `${ch}${inner}${ch}`
        else out += `[${serializeInline(run, { ...opts, inBracket: true })}]{${spanClass(best)}}`
      }
    }
  }
  return out
}

const DELIM_TYPES = new Set<MarkType>(["bold", "italic", "strike", "highlight", "sup", "sub"])

/** Move leading/trailing spaces out of bold/italic/... runs so delimiters stay flanking (`**a** b`, not `**a **b`). */
function shedWhitespace(nodes: Inline[]): Inline[] {
  const out: Inline[] = []
  const shares = (n: Inline | undefined, m: Mark) => !!n?.marks?.some((x) => markEq(x, m))
  nodes.forEach((n, idx) => {
    if (n.type !== "text" || !n.marks?.some((m) => DELIM_TYPES.has(m.type))) return out.push(n)
    const dm = n.marks.filter((m) => DELIM_TYPES.has(m.type))
    const lead = /^\s+/.exec(n.text)?.[0] ?? ""
    const trail = n.text.length > lead.length ? (/\s+$/.exec(n.text)?.[0] ?? "") : ""
    const shedLead = lead && dm.some((m) => !shares(nodes[idx - 1], m))
    const shedTrail = trail && dm.some((m) => !shares(nodes[idx + 1], m))
    const keep = n.marks.filter((m) => !DELIM_TYPES.has(m.type))
    let body = n.text
    if (shedLead) body = body.slice(lead.length)
    if (shedTrail) body = body.slice(0, body.length - trail.length)
    if (shedLead) out.push({ type: "text", text: lead, ...(keep.length ? { marks: keep } : {}) })
    if (body) out.push({ ...n, text: body })
    if (shedTrail) out.push({ type: "text", text: trail, ...(keep.length ? { marks: keep } : {}) })
  })
  return normalizeInlines(out)
}

function atomSrc(n: Inline, opts: SerOpts): string {
  switch (n.type) {
    case "text":
      return escapeText(n.text, opts)
    case "break":
      return opts.table ? "<br>" : "\\\n"
    case "footnote":
      return `^[${serializeInline(n.content, { ...opts, inBracket: true })}]`
    case "cite":
      return `[${n.keys.map((k) => "@" + k).join("; ")}${n.locator ? ", " + n.locator : ""}]`
  }
}

/** Plain text of inline content (footnotes excluded). */
export function inlineText(nodes: Inline[], opts: { deletions?: boolean } = {}): string {
  return nodes
    .map((n) => {
      if (!opts.deletions && hasMark(n, "deletion")) return ""
      if (n.type === "text") return n.text
      if (n.type === "break") return "\n"
      if (n.type === "cite") return `[${n.keys.join(", ")}]`
      return ""
    })
    .join("")
}

export function text(t: string, marks?: Mark[]): TextNode {
  return marks?.length ? { type: "text", text: t, marks } : { type: "text", text: t }
}
