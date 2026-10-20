/**
 * Pagination for a single ProseMirror editor.
 *
 * The document stays one contenteditable (so selection, typing, undo and copy/paste
 * work across pages). After each update we measure every top-level block, run the
 * shared `paginate()` layout, and insert non-editable widget decorations between
 * blocks. Each widget draws: the blank rest of the page, that page's footnotes,
 * its footer, the gap between sheets, and the next page's header. The result looks
 * and prints like separate pages.
 *
 * Limitation: breaks fall between top-level blocks; a single block taller than the
 * remaining space moves to the next page (a block taller than a page overflows).
 */
import { Extension } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { fillTemplate, outline, paginate, type Inline, type LayoutItem } from "@word2/sdk"
import { escapeHTML, inlineToHTML } from "../shared/html"
import { PAGE_GAP, pageGeometry, type PageGeometry } from "../shared/geometry"
import type { EditorBridge } from "./bridge"

type PageInfo = { start: number; end: number; fill: number; footnotes: Inline[][]; fnStart: number }
type PagState = { pages: PageInfo[] | null; deco: DecorationSet }

export const paginationKey = new PluginKey<PagState>("w2-pagination")

function zoneHTML(parts: string[], cls: string, height: number) {
  return `<div class="${cls}" style="height:${height}px"><span>${escapeHTML(parts[0] ?? "")}</span><span>${escapeHTML(parts[1] ?? "")}</span><span>${escapeHTML(parts[2] ?? "")}</span></div>`
}

function footnotesHTML(fns: Inline[][], start: number) {
  if (!fns.length) return ""
  return `<div class="w2-page-footnotes">${fns
    .map((c, i) => `<div class="w2-footnote"><sup>${start + i}</sup> ${inlineToHTML(c)}</div>`)
    .join("")}</div>`
}

function buildDecorations(doc: PMNode, pages: PageInfo[], bridge: EditorBridge): DecorationSet {
  const g = pageGeometry(bridge.doc.meta)
  const meta = bridge.doc.meta
  const total = pages.length
  const sectionAt = (blockIndex: number) => {
    // running header field {{section}}: last H1 before this block
    const items = outline(bridge.doc).filter((o) => o.level === 1 && o.index <= blockIndex)
    return items[items.length - 1]?.text ?? ""
  }
  const header = (n: number, blockIndex: number) =>
    meta.header && !(meta.titlePage && n === 1)
      ? fillTemplate(meta.header, { page: n, pages: total, meta, section: sectionAt(blockIndex) })
      : ["", "", ""]
  const footer = (n: number, blockIndex: number) =>
    meta.footer && !(meta.titlePage && n === 1)
      ? fillTemplate(meta.footer, { page: n, pages: total, meta, section: sectionAt(blockIndex) })
      : ["", "", ""]

  const positions: number[] = []
  doc.forEach((_n, pos) => positions.push(pos))
  const decos: Decoration[] = []
  const side = `margin-left:-${g.left}px;margin-right:-${g.right}px`

  const firstHeader = `<div class="w2-page-top" style="${side}">${zoneHTML(header(1, 0), "w2-page-header", g.top)}</div>`
  decos.push(Decoration.widget(0, () => html(firstHeader), { side: -1, key: "w2-top-" + firstHeader.length + firstHeader.slice(-80), ignoreSelection: true }))

  pages.forEach((p, k) => {
    const n = k + 1
    const isLast = k === pages.length - 1
    const bottom =
      `<div class="w2-page-fill" style="height:${Math.max(0, p.fill)}px"></div>` +
      footnotesHTML(p.footnotes, p.fnStart) +
      zoneHTML(footer(n, p.start), "w2-page-footer", g.bottom)
    const content = isLast
      ? `<div class="w2-page-end" style="${side}">${bottom}</div>`
      : `<div class="w2-page-break" style="${side}" data-page="${n}">${bottom}<div class="w2-page-gap" style="height:${PAGE_GAP}px"></div>${zoneHTML(header(n + 1, pages[k + 1].start), "w2-page-header", g.top)}</div>`
    const pos = isLast ? doc.content.size : positions[pages[k + 1].start] ?? doc.content.size
    decos.push(Decoration.widget(pos, () => html(content), { side: isLast ? 1 : -1, key: `w2-p${n}-${hash(content)}`, ignoreSelection: true }))
  })
  return DecorationSet.create(doc, decos)
}

function html(s: string): HTMLElement {
  const t = document.createElement("template")
  t.innerHTML = s
  const el = t.content.firstElementChild as HTMLElement
  el.contentEditable = "false"
  return el
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h.toString(36)
}

class Measurer {
  private raf = 0
  private ro: ResizeObserver
  private box: HTMLDivElement
  private fnCache = new Map<string, number>()
  private off: () => void
  private lastSig = ""

  constructor(
    private view: EditorView,
    private bridge: EditorBridge,
  ) {
    this.ro = new ResizeObserver(() => this.schedule())
    this.ro.observe(view.dom)
    this.box = document.createElement("div")
    this.box.className = "w2-measure"
    this.box.setAttribute("aria-hidden", "true")
    view.dom.parentElement?.appendChild(this.box)
    this.off = bridge.on("config", () => {
      this.fnCache.clear()
      this.schedule()
    })
    document.fonts?.ready.then(() => this.schedule())
    this.schedule()
  }

  schedule() {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.measure())
  }

  private fnHeight(fns: Inline[][], width: number): number {
    let h = 0
    for (const c of fns) {
      const key = width + JSON.stringify(c)
      let v = this.fnCache.get(key)
      if (v === undefined) {
        this.box.style.width = `${width}px`
        this.box.innerHTML = `<div class="w2-page-footnotes"><div class="w2-footnote"><sup>9</sup> ${inlineToHTML(c)}</div></div>`
        v = (this.box.firstElementChild as HTMLElement).offsetHeight
        this.fnCache.set(key, v)
      }
      h += v
    }
    return h
  }

  measure() {
    const { view, bridge } = this
    if (!view.dom.isConnected) return
    const state = paginationKey.getState(view.state)
    if (bridge.mode !== "print") {
      if (state?.pages) view.dispatch(view.state.tr.setMeta(paginationKey, null).setMeta("addToHistory", false))
      return
    }
    const g: PageGeometry = pageGeometry(bridge.doc.meta)
    const items: LayoutItem[] = []
    const fnPer: Inline[][][] = []
    const bids: (string | null)[] = []
    view.state.doc.forEach((node, pos) => {
      const dom = view.nodeDOM(pos)
      let h = 0
      if (dom instanceof HTMLElement) {
        const cs = getComputedStyle(dom)
        h = dom.offsetHeight + parseFloat(cs.marginTop || "0") + parseFloat(cs.marginBottom || "0")
      }
      const fns: Inline[][] = []
      node.descendants((n) => {
        if (n.type.name === "footnote") fns.push(n.attrs.content as Inline[])
      })
      fnPer.push(fns)
      bids.push(node.attrs.bid ?? null)
      items.push({
        height: h,
        pageBreak: node.type.name === "pageBreak",
        keepWithNext: node.type.name === "heading",
        footnoteHeight: fns.length ? this.fnHeight(fns, g.contentWidth) : 0,
      })
    })
    const slices = paginate(items, g.contentHeight)
    let fnCount = 1
    const pages: PageInfo[] = slices.map((s) => {
      const footnotes = fnPer.slice(s.start, s.end).flat()
      const p = { start: s.start, end: s.end, fill: Math.floor(g.contentHeight - s.used - s.footnoteHeight), footnotes, fnStart: fnCount }
      fnCount += footnotes.length
      return p
    })
    const m = bridge.doc.meta
    const sig = JSON.stringify({ pages, h: m.header, f: m.footer, t: m.title, a: m.author, tp: m.titlePage, g, o: outline(bridge.doc).filter((x) => x.level === 1).map((x) => [x.index, x.text]) })
    const same = !!state?.pages && sig === this.lastSig
    this.lastSig = sig
    if (!same) view.dispatch(view.state.tr.setMeta(paginationKey, pages).setMeta("addToHistory", false))

    const pageOf = new Map<string, number>()
    slices.forEach((s, k) => {
      for (let i = s.start; i < s.end; i++) if (bids[i]) pageOf.set(bids[i]!, k + 1)
    })
    const prev = bridge.layout
    const changed = prev.pages !== slices.length || [...pageOf].some(([k, v]) => prev.pageOf.get(k) !== v)
    if (changed) {
      bridge.update({ layout: { pages: slices.length, pageOf } })
      bridge.emit("layout", bridge.layout)
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.box.remove()
    this.off()
  }
}

export const Pagination = Extension.create<{ bridge: EditorBridge }>({
  name: "w2Pagination",
  addProseMirrorPlugins() {
    const bridge = this.options.bridge
    return [
      new Plugin<PagState>({
        key: paginationKey,
        state: {
          init: () => ({ pages: null, deco: DecorationSet.empty }),
          apply(tr, prev, _old, state: EditorState) {
            const meta = tr.getMeta(paginationKey) as PageInfo[] | null | undefined
            if (meta !== undefined) return { pages: meta, deco: meta ? buildDecorations(state.doc, meta, bridge) : DecorationSet.empty }
            if (!tr.docChanged) return prev
            return { pages: prev.pages, deco: prev.deco.map(tr.mapping, tr.doc) }
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state)?.deco,
        },
        view(view) {
          const m = new Measurer(view, bridge)
          return { update: () => m.schedule(), destroy: () => m.destroy() }
        },
      }),
    ]
  },
})
