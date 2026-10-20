/**
 * Export a word2 document to .docx. Suggestions become real Word tracked changes,
 * comments become Word comments (with replies), footnotes are native footnotes,
 * charts are native (editable) Word charts.
 */
import {
  AlignmentType,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document as DocxDocument,
  ExternalHyperlink,
  FootnoteReferenceRun,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  InsertedTextRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  SectionType,
  ShadingType,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type ICommentOptions,
  type IRunOptions,
  type ISectionOptions,
  type ParagraphChild,
} from "docx"
import { ChartRun } from "docx/charts"
import { inlineText } from "../inline"
import type { Align, Block, Chart, Document, Inline, Mark } from "../model"
import { pageDimensions, pageSetup } from "../model"
import { bibliography, citedKeys, formatCitation, formatReference } from "../ops"
import { resolveTheme } from "../theme"

const MM = 56.6929 // twips per mm

export type DocxOptions = {
  /** load image bytes; defaults to fetch() */
  loadImage?: (src: string) => Promise<{ data: Uint8Array; width: number; height: number; type: "png" | "jpg" | "gif" | "bmp" } | null>
}

type Revision = { kind: "insert" | "delete"; author: string }

const ALIGN: Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

const firstFont = (stack: string) => stack.split(",")[0].replace(/['"]/g, "").trim()
const hex = (c?: string) => (c ? c.replace("#", "").slice(0, 6).toUpperCase() : undefined)

export async function exportDocx(doc: Document, opts: DocxOptions = {}): Promise<Blob> {
  const theme = resolveTheme(doc.meta)
  const setup = pageSetup(doc.meta)
  const dim = pageDimensions(setup)
  const contentWidthTw = (dim.width - setup.margins.left - setup.margins.right) * MM
  const contentWidthPx = (dim.width - setup.margins.left - setup.margins.right) * 3.78
  const cited = citedKeys(doc)
  const date = new Date().toISOString()

  let revId = 1
  let footId = 1
  let numInstance = 0
  const footnotes: Record<number, { children: Paragraph[] }> = {}
  const comments: ICommentOptions[] = []
  const commentIds = new Map<string, number>()
  const openComments = new Set<string>()

  const runProps = (marks: Mark[] = []): Partial<IRunOptions> => {
    const p: Record<string, unknown> = {}
    for (const m of marks) {
      if (m.type === "bold") p.bold = true
      if (m.type === "italic") p.italics = true
      if (m.type === "underline") p.underline = {}
      if (m.type === "strike") p.strike = true
      if (m.type === "sup") p.superScript = true
      if (m.type === "sub") p.subScript = true
      if (m.type === "smallcaps") p.smallCaps = true
      if (m.type === "highlight") p.highlight = "yellow"
      if (m.type === "color") p.color = hex(m.color)
      if (m.type === "code") p.font = "Courier New"
      if (m.type === "link") {
        p.color = hex(theme.accent)
        p.underline = {}
      }
    }
    return p as Partial<IRunOptions>
  }

  const run = (text: string, marks: Mark[] = [], rev?: Revision): ParagraphChild => {
    const ins = marks.find((m) => m.type === "insertion") as Extract<Mark, { type: "insertion" }> | undefined
    const del = marks.find((m) => m.type === "deletion") as Extract<Mark, { type: "deletion" }> | undefined
    const props = { ...runProps(marks), text }
    if (ins || rev?.kind === "insert") return new InsertedTextRun({ ...props, id: revId++, author: ins?.author ?? rev?.author ?? "word2", date })
    if (del || rev?.kind === "delete") return new DeletedTextRun({ ...props, id: revId++, author: del?.author ?? rev?.author ?? "word2", date })
    return new TextRun(props)
  }

  const inlines = (content: Inline[], rev?: Revision): ParagraphChild[] => {
    const out: ParagraphChild[] = []
    const closeComments = (keep: Set<string>) => {
      for (const id of [...openComments]) {
        if (keep.has(id)) continue
        const n = commentIds.get(id)!
        out.push(new CommentRangeEnd(n), new TextRun({ children: [new CommentReference(n)] }))
        openComments.delete(id)
      }
    }
    for (const n of content) {
      const cms = (n.marks ?? []).filter((m) => m.type === "comment") as Extract<Mark, { type: "comment" }>[]
      closeComments(new Set(cms.map((c) => c.id)))
      for (const c of cms) {
        if (openComments.has(c.id)) continue
        let num = commentIds.get(c.id)
        if (num === undefined) {
          num = comments.length
          commentIds.set(c.id, num)
          c.thread.forEach((msg, k) => {
            const id = k === 0 ? num! : 1000 + comments.length
            comments.push({
              id,
              author: msg.author || "word2",
              date: new Date(),
              children: [new Paragraph(msg.text)],
              ...(k > 0 ? { parentId: num } : {}),
            })
          })
        }
        out.push(new CommentRangeStart(num))
        openComments.add(c.id)
      }
      const link = n.marks?.find((m) => m.type === "link") as Extract<Mark, { type: "link" }> | undefined
      let child: ParagraphChild
      if (n.type === "text") child = run(n.text, n.marks, rev)
      else if (n.type === "break") child = new TextRun({ break: 1 })
      else if (n.type === "cite") child = run(formatCitation(n, doc.meta, cited), n.marks, rev)
      else {
        const id = footId++
        footnotes[id] = { children: [new Paragraph({ children: inlines(n.content) })] }
        child = new FootnoteReferenceRun(id)
      }
      out.push(link ? new ExternalHyperlink({ link: link.href, children: [child] }) : child)
    }
    closeComments(new Set())
    return out
  }

  const para = (content: Inline[], extra: Record<string, unknown> = {}, rev?: Revision) =>
    new Paragraph({ children: inlines(content, rev), ...extra })

  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]

  const loadImage =
    opts.loadImage ??
    (async (src: string) => {
      try {
        const res = await fetch(src)
        const buf = new Uint8Array(await res.arrayBuffer())
        const ct = res.headers.get("content-type") ?? src
        const type = /png/.test(ct) ? "png" : /gif/.test(ct) ? "gif" : /bmp/.test(ct) ? "bmp" : "jpg"
        let width = 600
        let height = 400
        if (typeof createImageBitmap !== "undefined") {
          const bmp = await createImageBitmap(new Blob([buf]))
          width = bmp.width
          height = bmp.height
        }
        return { data: buf, width, height, type: type as "png" }
      } catch {
        return null
      }
    })

  const chartRun = (c: Chart) => {
    const categories = c.data.map((d) => String(d[c.x] ?? ""))
    const series = c.y.map((y) => ({ name: y, values: c.data.map((d) => (typeof d[y] === "number" ? (d[y] as number) : Number(d[y]) || null)) }))
    const base = { title: c.title, transformation: { width: Math.min(600, contentWidthPx), height: 320 } }
    if (c.chart === "pie") return new ChartRun({ ...base, type: "pie", categories, series: series.slice(0, 1) as never })
    return new ChartRun({
      ...base,
      type: c.chart === "bar" ? "column" : c.chart,
      categories,
      series,
      ...(c.stacked ? { stacking: "stacked" as const } : {}),
    } as never)
  }

  type Child = Paragraph | Table | TableOfContents
  const sections: ISectionOptions[] = []
  let children: Child[] = []

  const blocks = async (list: Block[], ctx: { indent?: number; rev?: Revision; listLevel?: number } = {}): Promise<Child[]> => {
    const out: Child[] = []
    for (const b of list) out.push(...(await block(b, ctx)))
    return out
  }

  const block = async (b: Block, ctx: { indent?: number; rev?: Revision; listLevel?: number }): Promise<Child[]> => {
    const indent = ctx.indent ? { indent: { left: ctx.indent } } : {}
    switch (b.type) {
      case "paragraph":
        return [para(b.content, { ...indent, alignment: b.align ? ALIGN[b.align] : theme.justify ? AlignmentType.JUSTIFIED : undefined }, ctx.rev)]
      case "heading":
        return [para(b.content, { heading: HEADINGS[b.level - 1], alignment: b.align ? ALIGN[b.align] : undefined }, ctx.rev)]
      case "list": {
        const level = ctx.listLevel ?? 0
        const instance = ++numInstance
        const out: Child[] = []
        for (const it of b.items) {
          for (const [k, child] of it.blocks.entries()) {
            if (child.type === "paragraph" && k === 0) {
              const prefix: Inline[] = b.kind === "task" ? [{ type: "text", text: it.checked ? "☒ " : "☐ " }] : []
              const numbering =
                b.kind === "ordered" ? { numbering: { reference: "w2-ordered", level, instance } } : b.kind === "bullet" ? { bullet: { level } } : { indent: { left: 360 * (level + 1) } }
              out.push(para([...prefix, ...child.content], numbering, ctx.rev))
            } else out.push(...(await block(child, { ...ctx, listLevel: level + 1, indent: 720 * (level + 1) })))
          }
        }
        return out
      }
      case "blockquote":
      case "callout": {
        const inner = await blocks(b.blocks, { ...ctx, indent: (ctx.indent ?? 0) + 400 })
        const title = b.type === "callout" ? [new Paragraph({ children: [new TextRun({ text: b.title ?? b.variant.toUpperCase(), bold: true })], indent: { left: (ctx.indent ?? 0) + 400 } })] : []
        return [...title, ...inner]
      }
      case "code":
        return b.text.split("\n").map(
          (line) =>
            new Paragraph({
              children: [new TextRun({ text: line || " ", font: "Courier New", size: 18 })],
              shading: { type: ShadingType.CLEAR, fill: "F3F4F6", color: "auto" },
              spacing: { after: 0 },
            }),
        )
      case "table": {
        const rows = b.rows.map(
          (r, ri) =>
            new TableRow({
              tableHeader: b.header && ri === 0,
              children: r.cells.map(
                (c) =>
                  new TableCell({
                    children: [para(c.content, { alignment: c.align ? ALIGN[c.align] : undefined }, ctx.rev)],
                    shading: b.header && ri === 0 ? { type: ShadingType.CLEAR, fill: "EEF1F4", color: "auto" } : undefined,
                  }),
              ),
            }),
        )
        const out: Child[] = [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })]
        if (b.caption) out.push(new Paragraph({ children: [new TextRun({ text: b.caption, italics: true, size: 18 })], alignment: AlignmentType.CENTER }))
        return out
      }
      case "image": {
        const img = await loadImage(b.src)
        if (!img) return [new Paragraph({ children: [new TextRun({ text: `[image: ${b.alt ?? b.src}]`, italics: true })] })]
        const pct = b.width?.endsWith("%") ? parseFloat(b.width) / 100 : 1
        const w = Math.min(contentWidthPx * pct, img.width)
        const h = (img.height / img.width) * w
        const out: Child[] = [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: w, height: h } })] }),
        ]
        if (b.caption) out.push(new Paragraph({ children: [new TextRun({ text: b.caption, italics: true, size: 18 })], alignment: AlignmentType.CENTER }))
        return out
      }
      case "chart": {
        const out: Child[] = []
        try {
          out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [chartRun(b)] }))
        } catch {
          out.push(new Paragraph({ children: [new TextRun({ text: `[chart: ${b.title ?? ""}]`, italics: true })] }))
        }
        if (b.caption) out.push(new Paragraph({ children: [new TextRun({ text: b.caption, italics: true, size: 18 })], alignment: AlignmentType.CENTER }))
        return out
      }
      case "divider":
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } }, children: [] })]
      case "pagebreak":
        return [new Paragraph({ children: [new PageBreak()] })]
      case "toc":
        return [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(b.title ?? "Contents")] }),
          new TableOfContents(b.title ?? "Contents", { hyperlink: true, headingStyleRange: `1-${b.depth ?? 3}` }),
        ]
      case "references": {
        const refs = bibliography(doc)
        return [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(b.title ?? "References")] }),
          ...refs.map((r, i) => new Paragraph({ children: [new TextRun(`${doc.meta.citationStyle === "numeric" ? `[${i + 1}] ` : ""}${formatReference(r)}`)] })),
        ]
      }
      case "columns": {
        // columns live in their own continuous section
        sections.push({ properties: { type: SectionType.CONTINUOUS }, children: children.splice(0) as never })
        const inner = await blocks(b.blocks, ctx)
        sections.push({ properties: { type: SectionType.CONTINUOUS, column: { count: b.count, space: 708 } }, children: inner as never })
        return []
      }
      case "suggestion":
        return blocks(b.blocks, { ...ctx, rev: { kind: b.kind, author: b.author ?? "word2" } })
    }
  }

  for (const b of doc.blocks) children.push(...(await block(b, {})))

  const zone = (tpl?: string) => {
    if (!tpl) return undefined
    const parts = tpl.split("|").map((s) => s.trim())
    const zones = parts.length === 1 ? ["", parts[0], ""] : parts.length === 2 ? [parts[0], "", parts[1]] : parts.slice(0, 3)
    const runsOf = (s: string) =>
      s.split(/(\{\{\s*\w+\s*\}\})/).filter(Boolean).map((piece) => {
        const f = /\{\{\s*(\w+)\s*\}\}/.exec(piece)?.[1]
        if (f === "page") return new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "666666" })
        if (f === "pages") return new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "666666" })
        const val = f ? String((doc.meta as Record<string, unknown>)[f] ?? "") : piece
        return new TextRun({ text: val, size: 18, color: "666666" })
      })
    return new Paragraph({
      tabStops: [
        { type: TabStopType.CENTER, position: contentWidthTw / 2 },
        { type: TabStopType.RIGHT, position: contentWidthTw },
      ],
      children: [...runsOf(zones[0]), new TextRun({ children: [new Tab()] }), ...runsOf(zones[1]), new TextRun({ children: [new Tab()] }), ...runsOf(zones[2])],
    })
  }

  const header = zone(doc.meta.header)
  const footer = zone(doc.meta.footer)
  const pageProps = {
    page: {
      size: {
        width: pageDimensions({ ...setup, orientation: "portrait" }).width * MM,
        height: pageDimensions({ ...setup, orientation: "portrait" }).height * MM,
        orientation: setup.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
      },
      margin: { top: setup.margins.top * MM, right: setup.margins.right * MM, bottom: setup.margins.bottom * MM, left: setup.margins.left * MM },
    },
    titlePage: !!doc.meta.titlePage,
  }
  sections.push({ properties: { type: SectionType.CONTINUOUS }, children: children as never })
  const nonEmpty = sections.filter((s, i) => i === 0 || (s.children as unknown[]).length > 0)
  nonEmpty.forEach((s, i) => {
    ;(s as { properties: Record<string, unknown> }).properties = { ...s.properties, ...pageProps, ...(i === 0 ? { type: undefined } : {}) }
  })
  if (header || footer) {
    nonEmpty[0] = {
      ...nonEmpty[0],
      headers: header ? { default: new Header({ children: [header] }), ...(doc.meta.titlePage ? { first: new Header({ children: [] }) } : {}) } : undefined,
      footers: footer ? { default: new Footer({ children: [footer] }), ...(doc.meta.titlePage ? { first: new Footer({ children: [] }) } : {}) } : undefined,
    }
  }

  const titleBlock: Paragraph[] = doc.meta.title
    ? [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(doc.meta.title)] }),
        ...(doc.meta.subtitle ? [new Paragraph({ children: [new TextRun({ text: doc.meta.subtitle, size: 28, color: "555555" })] })] : []),
      ]
    : []
  nonEmpty[0] = { ...nonEmpty[0], children: [...titleBlock, ...(nonEmpty[0].children as never[])] }

  const font = firstFont(theme.bodyFont)
  const headingFont = firstFont(theme.headingFont)
  const d = new DocxDocument({
    creator: doc.meta.author ?? "word2",
    title: doc.meta.title ?? "Untitled",
    features: { updateFields: true },
    comments: { children: comments },
    footnotes,
    numbering: {
      config: [
        {
          reference: "w2-ordered",
          levels: Array.from({ length: 6 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font, size: Math.round(theme.fontSize * 2), color: hex(theme.textColor) }, paragraph: { spacing: { after: 120, line: Math.round(240 * theme.lineHeight) } } },
        heading1: { run: { font: headingFont, size: Math.round(theme.fontSize * 2 * 1.9), bold: true, color: hex(theme.headingColor) }, paragraph: { spacing: { before: 360, after: 120 } } },
        heading2: { run: { font: headingFont, size: Math.round(theme.fontSize * 2 * 1.45), bold: true, color: hex(theme.headingColor) }, paragraph: { spacing: { before: 280, after: 100 } } },
        heading3: { run: { font: headingFont, size: Math.round(theme.fontSize * 2 * 1.2), bold: true, color: hex(theme.headingColor) }, paragraph: { spacing: { before: 220, after: 80 } } },
        title: { run: { font: headingFont, size: Math.round(theme.fontSize * 2 * 2.6), bold: true, color: hex(theme.headingColor) } },
      },
    },
    sections: nonEmpty,
  })
  return Packer.toBlob(d)
}

export { inlineText }
