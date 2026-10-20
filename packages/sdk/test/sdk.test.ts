import { describe, expect, it } from "vitest"
import {
  addComment,
  buildSourceCache,
  contentKey,
  diffInlines,
  listComments,
  listSuggestions,
  moveSection,
  outline,
  paginate,
  parse,
  parseInline,
  resolveAll,
  resolveSuggestion,
  serialize,
  serializeInline,
  suggestBlocks,
  type Document,
} from "../src"
import { SAMPLE } from "./fixture"

const strip = (d: Document) => JSON.parse(contentKey(d))

describe("parse", () => {
  const { doc, errors } = parse(SAMPLE)
  it("parses without errors", () => expect(errors).toEqual([]))
  it("reads front matter", () => {
    expect(doc.meta.title).toBe("Quarterly Report")
    expect(doc.meta.page?.margins?.top).toBe(20)
    expect(doc.meta.references?.[0].id).toBe("smith2020")
  })
  it("recognises block types", () => {
    expect(doc.blocks.map((b) => b.type)).toEqual([
      "toc", "heading", "paragraph", "paragraph", "paragraph", "heading", "list", "list", "list", "blockquote",
      "callout", "table", "chart", "image", "pagebreak", "columns", "suggestion", "code", "divider", "paragraph", "references",
    ])
  })
  it("parses inline marks, footnotes, citations, suggestions and comments", () => {
    const p = doc.blocks[2]
    if (p.type !== "paragraph") throw new Error()
    expect(p.content.find((n) => n.type === "footnote")).toBeTruthy()
    expect(p.content.find((n) => n.type === "cite")).toMatchObject({ keys: ["smith2020"], locator: "p. 4" })
    const sug = listSuggestions(doc)
    expect(sug.map((s) => [s.kind, s.inserted, s.deleted, s.author])).toEqual([
      ["insert", "really ", "", "claude"],
      ["replace", "new", "old", undefined],
      ["insert", "A new concluding paragraph.", "", "claude"],
    ])
    expect(listComments(doc)[0]).toMatchObject({ quote: "This needs a source", thread: [{ author: "alex" }, { author: "claude" }] })
  })
  it("parses tables, nested lists, tasks, charts", () => {
    const t = doc.blocks[11]
    expect(t.type === "table" && [t.rows.length, t.caption, t.rows[0].cells[1].align]).toEqual([3, "Revenue by region", "right"])
    const l = doc.blocks[6]
    expect(l.type === "list" && l.items[1].blocks.map((b) => b.type)).toEqual(["paragraph", "list"])
    const tasks = doc.blocks[8]
    expect(tasks.type === "list" && tasks.kind === "task" && tasks.items.map((i) => i.checked)).toEqual([true, false])
    const c = doc.blocks[12]
    expect(c.type === "chart" && [c.chart, c.y, c.data[1].revenue]).toEqual(["bar", ["revenue", "cost"], 140])
  })
})

describe("round trip", () => {
  it("serialize(parse(x)) parses back to the same document", () => {
    const a = parse(SAMPLE).doc
    const text = serialize(a).text
    const b = parse(text).doc
    expect(strip(b)).toEqual(strip(a))
    // and printing is stable
    expect(serialize(b).text).toBe(text)
  })
  it("inline edge cases survive", () => {
    const cases = [
      "**bold** then *italic* then ***both***",
      "snake_case_name and 2 * 3 * 4",
      "a [link with **bold**](https://x.y/a_(b)) here",
      "escaped \\*stars\\* and [brackets] stay",
      "{~~a~>b~~}{>>@claude: why<<} and {--gone--}",
      "nested ^[note with *em*] footnote",
    ]
    for (const c of cases) {
      const a = parseInline(c)
      const b = parseInline(serializeInline(a))
      expect(b, c).toEqual(a)
    }
  })
  it("adjacent marks don't merge into ambiguous delimiter runs", () => {
    const nodes = [
      { type: "text" as const, text: "a", marks: [{ type: "bold" as const }] },
      { type: "text" as const, text: "b", marks: [{ type: "bold" as const }, { type: "italic" as const }] },
      { type: "text" as const, text: "c", marks: [{ type: "italic" as const }] },
      { type: "text" as const, text: " d ", marks: [{ type: "bold" as const }] },
    ]
    const src = serializeInline(nodes)
    expect(parseInline(src).map((n) => [n.type === "text" && n.text, n.marks?.map((m) => m.type)])).toEqual([
      ["a", ["bold"]], ["b", ["bold", "italic"]], ["c", ["italic"]], [" ", undefined], ["d", ["bold"]], [" ", undefined],
    ])
  })
  it("reuses original source for unchanged blocks", () => {
    const src = "# Title\n\nSome   *messy*    paragraph\nover lines.\n\nEdit me.\n"
    const r = parse(src)
    const cache = buildSourceCache(src, r)
    const doc = { ...r.doc, blocks: r.doc.blocks.map((b, i) => (i === 2 ? { ...b, content: [{ type: "text" as const, text: "Edited." }] } : b)) }
    expect(serialize(doc, cache).text).toBe("# Title\n\nSome   *messy*    paragraph\nover lines.\n\nEdited.\n")
  })
  it("keeps block ids stable across re-parse", () => {
    const a = parse("# A\n\nOne\n\nTwo\n")
    const b = parse("# A\n\nOne changed\n\nTwo\n", a.doc)
    expect(b.doc.blocks.map((x) => x.id)).toEqual(a.doc.blocks.map((x) => x.id))
    const c = parse("Intro\n\n# A\n\nOne changed\n\nTwo\n", b.doc)
    expect(c.doc.blocks.slice(1).map((x) => x.id)).toEqual(a.doc.blocks.map((x) => x.id))
  })
})

describe("suggestions", () => {
  const para = (s: string) => parse(s).doc.blocks[0] as unknown as { content: never }
  it("diffs words into tracked changes", () => {
    const out = diffInlines(para("The quick brown fox jumps.").content, para("The fast brown fox leaps high.").content, { author: "claude", note: "tighter" })
    expect(serializeInline(out)).toBe(
      "The {~~quick~>fast~~}{>>@claude: tighter<<} brown fox {~~jumps~>leaps high~~}{>>@claude: tighter<<}.",
    )
  })
  it("accepts and rejects individually", () => {
    const doc = parse("The {~~quick~>fast~~} fox {++really ++}jumps.").doc
    const [s1, s2] = listSuggestions(doc)
    const a = resolveSuggestion(doc, s1.sid, true)
    expect(serialize(a).text.trim()).toBe("The fast fox {++really ++}jumps.")
    const b = resolveSuggestion(a, s2.sid, false)
    expect(serialize(b).text.trim()).toBe("The fast fox jumps.")
    expect(serialize(resolveAll(doc, false)).text.trim()).toBe("The quick fox jumps.")
  })
  it("proposes block insertions and deletions", () => {
    const old = parse("# H\n\nKeep.\n\nDrop.\n").doc.blocks
    const neu = parse("# H\n\nKeep.\n\nNew one.\n\n- a list\n").doc.blocks
    const out = suggestBlocks(old, neu, { author: "claude" })
    const text = serialize({ meta: {}, blocks: out }).text
    expect(text).toContain("{~~Drop~>New one~~}")
    expect(text).toContain(":::suggest{type=insert by=claude}\n- a list\n:::")
  })
  it("adds comments on a quote", () => {
    const doc = parse("Hello brave new world.").doc
    const { doc: d2 } = addComment(doc, doc.blocks[0].id, "brave new", { author: "alex", text: "really?" })
    expect(serialize(d2).text.trim()).toBe("Hello {==brave new==}{>>@alex: really?<<} world.")
  })
})

describe("structure", () => {
  it("builds an outline and moves sections", () => {
    const doc = parse("# A\n\na\n\n## A1\n\n# B\n\nb\n").doc
    expect(outline(doc).map((o) => [o.text, o.number])).toEqual([["A", "1"], ["A1", "1.1"], ["B", "2"]])
    const b = outline(doc)[2].id
    const a = outline(doc)[0].id
    const moved = moveSection(doc, b, a)
    expect(serialize(moved).text).toBe("# B\n\nb\n\n# A\n\na\n\n## A1\n")
  })
  it("paginates with explicit breaks, keep-with-next and footnotes", () => {
    const pages = paginate(
      [{ height: 320 }, { height: 320 }, { height: 50, keepWithNext: true }, { height: 300 }, { height: 10, pageBreak: true }, { height: 100, footnoteHeight: 40 }],
      700,
    )
    expect(pages.map((p) => [p.start, p.end])).toEqual([[0, 2], [2, 5], [5, 6]])
    expect(pages[2].footnoteHeight).toBe(56)
  })
})
