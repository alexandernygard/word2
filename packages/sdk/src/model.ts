/**
 * The word2 document model. A document is a plain, serialisable tree:
 * front-matter metadata (page setup, theme, header/footer, references, AI brief)
 * plus a list of blocks. Blocks contain inline content (text runs with marks).
 *
 * Every block carries an `id`. Ids are not written to the source format; they
 * are assigned at parse time and kept stable across edits (see reconcileIds),
 * so the editor, the code view and the AI can all address the same block.
 */

// ---------- inline ----------

export type CommentMessage = { author: string; text: string }

export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "code" }
  | { type: "sup" }
  | { type: "sub" }
  | { type: "smallcaps" }
  | { type: "highlight" }
  | { type: "color"; color: string }
  | { type: "link"; href: string; title?: string }
  /** tracked change: proposed insertion */
  | { type: "insertion"; id: string; author?: string; note?: string }
  /** tracked change: proposed deletion */
  | { type: "deletion"; id: string; author?: string; note?: string }
  /** comment thread anchored on a range */
  | { type: "comment"; id: string; thread: CommentMessage[] }

export type MarkType = Mark["type"]

export type TextNode = { type: "text"; text: string; marks?: Mark[] }
/** Footnote, stored inline at its reference point (`^[...]` in source). */
export type FootnoteNode = { type: "footnote"; content: Inline[]; marks?: Mark[] }
/** Citation of one or more references (`[@key, p. 4; @other]`). */
export type CiteNode = { type: "cite"; keys: string[]; locator?: string; marks?: Mark[] }
export type BreakNode = { type: "break"; marks?: Mark[] }

export type Inline = TextNode | FootnoteNode | CiteNode | BreakNode

// ---------- blocks ----------

export type Align = "left" | "center" | "right" | "justify"

type Base = { id: string }

export type Paragraph = Base & { type: "paragraph"; content: Inline[]; align?: Align }
export type Heading = Base & {
  type: "heading"
  level: 1 | 2 | 3 | 4 | 5 | 6
  content: Inline[]
  /** explicit anchor (`{#anchor}`), used for links and cross references */
  anchor?: string
  align?: Align
}
export type ListItem = { checked?: boolean; blocks: Block[] }
export type List = Base & {
  type: "list"
  kind: "bullet" | "ordered" | "task"
  start?: number
  items: ListItem[]
}
export type Blockquote = Base & { type: "blockquote"; blocks: Block[] }
export type CalloutVariant = "note" | "tip" | "warning" | "danger"
export type Callout = Base & { type: "callout"; variant: CalloutVariant; title?: string; blocks: Block[] }
export type CodeBlock = Base & { type: "code"; lang?: string; text: string }
export type TableCell = { content: Inline[]; align?: Align }
export type TableRow = { cells: TableCell[] }
export type Table = Base & {
  type: "table"
  /** first row is a header row */
  header: boolean
  rows: TableRow[]
  caption?: string
}
export type Image = Base & { type: "image"; src: string; alt?: string; caption?: string; width?: string }
export type ChartType = "bar" | "line" | "area" | "pie"
export type ChartSpec = {
  chart: ChartType
  title?: string
  /** column used for the x axis / pie labels */
  x: string
  /** columns plotted as series */
  y: string[]
  stacked?: boolean
  data: Record<string, string | number>[]
  caption?: string
}
export type Chart = Base & { type: "chart" } & ChartSpec
export type Divider = Base & { type: "divider" }
export type PageBreak = Base & { type: "pagebreak" }
export type Toc = Base & { type: "toc"; depth?: number; title?: string }
export type References = Base & { type: "references"; title?: string }
/** Multi-column region (newspaper columns) inside the page. */
export type Columns = Base & { type: "columns"; count: number; blocks: Block[] }
/** Block-level tracked change: whole blocks proposed for insertion or deletion. */
export type SuggestionBlock = Base & {
  type: "suggestion"
  kind: "insert" | "delete"
  sid: string
  author?: string
  note?: string
  blocks: Block[]
}

export type Block =
  | Paragraph
  | Heading
  | List
  | Blockquote
  | Callout
  | CodeBlock
  | Table
  | Image
  | Chart
  | Divider
  | PageBreak
  | Toc
  | References
  | Columns
  | SuggestionBlock

export type BlockType = Block["type"]

// ---------- document ----------

export type PageSize = "A4" | "A5" | "Letter" | "Legal"

export type PageSetup = {
  size: PageSize
  orientation: "portrait" | "landscape"
  /** margins in millimetres */
  margins: { top: number; right: number; bottom: number; left: number }
  columns?: number
}

export type Reference = {
  id: string
  author?: string
  title: string
  year?: string | number
  publisher?: string
  url?: string
}

export type ThemeOverrides = {
  bodyFont?: string
  headingFont?: string
  fontSize?: number
  lineHeight?: number
  textColor?: string
  headingColor?: string
  accent?: string
}

export type DocMeta = {
  title?: string
  subtitle?: string
  author?: string
  date?: string
  page?: Partial<PageSetup>
  theme?: string
  styles?: ThemeOverrides
  /** header/footer templates. `|` separates left|center|right; fields: {{page}} {{pages}} {{title}} {{author}} {{date}} */
  header?: string
  footer?: string
  /** hide header/footer on the first page */
  titlePage?: boolean
  numberedHeadings?: boolean
  citationStyle?: "author-date" | "numeric"
  references?: Reference[]
  /** standing brief the AI uses for every request: audience, tone, purpose... */
  ai?: Record<string, string>
  [key: string]: unknown
}

export type Document = { meta: DocMeta; blocks: Block[] }

export const PAGE_SIZES_MM: Record<PageSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
}

export const DEFAULT_PAGE: PageSetup = {
  size: "A4",
  orientation: "portrait",
  margins: { top: 25, right: 25, bottom: 25, left: 25 },
}

export function pageSetup(meta: DocMeta): PageSetup {
  const p = meta.page ?? {}
  return {
    size: p.size && p.size in PAGE_SIZES_MM ? p.size : DEFAULT_PAGE.size,
    orientation: p.orientation === "landscape" ? "landscape" : "portrait",
    margins: { ...DEFAULT_PAGE.margins, ...(p.margins ?? {}) },
    columns: p.columns,
  }
}

/** Page dimensions in millimetres, honouring orientation. */
export function pageDimensions(setup: PageSetup) {
  const s = PAGE_SIZES_MM[setup.size]
  return setup.orientation === "landscape" ? { width: s.height, height: s.width } : s
}

export const MM_TO_PX = 96 / 25.4

/** Blocks that contain child blocks. */
export function childBlocks(b: Block): Block[] | null {
  switch (b.type) {
    case "blockquote":
    case "callout":
    case "columns":
    case "suggestion":
      return b.blocks
    case "list":
      return b.items.flatMap((i) => i.blocks)
    default:
      return null
  }
}
