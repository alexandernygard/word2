/**
 * Programmatic construction API:
 *
 *   doc({ title: "Q3 report", theme: "report" },
 *     h1("Summary"),
 *     p("Revenue grew ", bold("18%"), " year on year", footnote("Unaudited.")),
 *     table([["Region", "Revenue"], ["EMEA", "4.1"]]),
 *     chart({ chart: "bar", x: "q", y: ["rev"], data: [...] }),
 *   )
 *
 * Strings are plain text; use md`...` to parse inline markdown.
 */
import { newId } from "./ids"
import { createInlineContext, parseInline } from "./inline"
import type { Align, Block, CalloutVariant, Chart, ChartSpec, DocMeta, Document, Heading, Inline, List, Mark, Table } from "./model"

export type InlineArg = string | Inline | Inline[]

export function md(strings: TemplateStringsArray | string, ...values: unknown[]): Inline[] {
  const src = typeof strings === "string" ? strings : strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""), "")
  return parseInline(src, createInlineContext())
}

export function inlines(args: InlineArg[]): Inline[] {
  return args.flatMap((a) => (typeof a === "string" ? [{ type: "text", text: a } as Inline] : Array.isArray(a) ? a : [a]))
}

function withMark(args: InlineArg[], mark: Mark): Inline[] {
  return inlines(args).map((n) => ({ ...n, marks: [...(n.marks ?? []), mark] }) as Inline)
}

export const bold = (...a: InlineArg[]) => withMark(a, { type: "bold" })
export const italic = (...a: InlineArg[]) => withMark(a, { type: "italic" })
export const underline = (...a: InlineArg[]) => withMark(a, { type: "underline" })
export const strike = (...a: InlineArg[]) => withMark(a, { type: "strike" })
export const code = (...a: InlineArg[]) => withMark(a, { type: "code" })
export const highlight = (...a: InlineArg[]) => withMark(a, { type: "highlight" })
export const color = (c: string, ...a: InlineArg[]) => withMark(a, { type: "color", color: c })
export const link = (href: string, ...a: InlineArg[]) => withMark(a.length ? a : [href], { type: "link", href })
export const footnote = (...a: InlineArg[]): Inline => ({ type: "footnote", content: inlines(a) })
export const cite = (keys: string | string[], locator?: string): Inline => ({
  type: "cite",
  keys: Array.isArray(keys) ? keys : [keys],
  ...(locator ? { locator } : {}),
})
export const br = (): Inline => ({ type: "break" })

export function doc(meta: DocMeta = {}, ...blocks: Block[]): Document {
  return { meta, blocks }
}

export const p = (...a: InlineArg[]): Block => ({ id: newId(), type: "paragraph", content: inlines(a) })
export const aligned = (align: Align, ...a: InlineArg[]): Block => ({ id: newId(), type: "paragraph", align, content: inlines(a) })
export const heading = (level: Heading["level"], ...a: InlineArg[]): Block => ({ id: newId(), type: "heading", level, content: inlines(a) })
export const h1 = (...a: InlineArg[]) => heading(1, ...a)
export const h2 = (...a: InlineArg[]) => heading(2, ...a)
export const h3 = (...a: InlineArg[]) => heading(3, ...a)

type ItemArg = InlineArg | Block[]
const item = (x: ItemArg) => ({ blocks: Array.isArray(x) && x.length && "id" in (x[0] as object) && !("text" in (x[0] as object)) ? (x as Block[]) : [p(x as InlineArg)] })
export const ul = (...items: ItemArg[]): List => ({ id: newId(), type: "list", kind: "bullet", items: items.map(item) })
export const ol = (...items: ItemArg[]): List => ({ id: newId(), type: "list", kind: "ordered", items: items.map(item) })
export const tasks = (...items: [boolean, InlineArg][]): List => ({
  id: newId(),
  type: "list",
  kind: "task",
  items: items.map(([checked, a]) => ({ checked, blocks: [p(a)] })),
})

export function table(rows: InlineArg[][], opts: { header?: boolean; caption?: string; align?: (Align | undefined)[] } = {}): Table {
  return {
    id: newId(),
    type: "table",
    header: opts.header ?? true,
    rows: rows.map((r) => ({ cells: r.map((c, i) => ({ content: inlines([c]), ...(opts.align?.[i] ? { align: opts.align[i] } : {}) })) })),
    ...(opts.caption ? { caption: opts.caption } : {}),
  }
}

export const chart = (spec: ChartSpec): Chart => ({ id: newId(), type: "chart", ...spec })
export const image = (src: string, opts: { alt?: string; caption?: string; width?: string } = {}): Block => ({ id: newId(), type: "image", src, ...opts })
export const quote = (...blocks: Block[]): Block => ({ id: newId(), type: "blockquote", blocks })
export const callout = (variant: CalloutVariant, title: string | undefined, ...blocks: Block[]): Block => ({
  id: newId(),
  type: "callout",
  variant,
  ...(title ? { title } : {}),
  blocks,
})
export const codeBlock = (lang: string, text: string): Block => ({ id: newId(), type: "code", lang, text })
export const columns = (count: number, ...blocks: Block[]): Block => ({ id: newId(), type: "columns", count, blocks })
export const toc = (depth?: number): Block => ({ id: newId(), type: "toc", ...(depth ? { depth } : {}) })
export const pageBreak = (): Block => ({ id: newId(), type: "pagebreak" })
export const divider = (): Block => ({ id: newId(), type: "divider" })
export const references = (title?: string): Block => ({ id: newId(), type: "references", ...(title ? { title } : {}) })
