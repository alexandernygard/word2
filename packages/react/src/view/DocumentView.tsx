import { fillTemplate, outline, paginate, themeVars, type Document, type PageSlice } from "@word2/sdk"
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { pageGeometry } from "../shared/geometry"
import { BlockView, blockFootnotes, createRenderContext, Inlines } from "./render"

export type DocumentViewProps = {
  doc: Document
  mode?: "print" | "web"
  /** called once pages are laid out (e.g. to trigger window.print) */
  onLaidOut?: (pages: number) => void
  className?: string
}

/**
 * Read-only renderer. In print mode it measures every block off-screen, paginates
 * with the same layout function the editor uses, and renders each page as a real
 * sheet (header, body, page footnotes, footer) that prints 1:1 with @page.
 */
export function DocumentView({ doc, mode = "print", onLaidOut, className }: DocumentViewProps) {
  const g = pageGeometry(doc.meta)
  const measureRef = useRef<HTMLDivElement>(null)
  const fnRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<PageSlice[] | null>(null)
  const ctx0 = useMemo(() => createRenderContext(doc), [doc])
  const fnPer = useMemo(() => doc.blocks.map(blockFootnotes), [doc])

  useLayoutEffect(() => {
    if (mode !== "print") return
    let cancelled = false
    const run = () => {
      if (cancelled || !measureRef.current || !fnRef.current) return
      const kids = [...measureRef.current.children] as HTMLElement[]
      const fnKids = [...fnRef.current.children] as HTMLElement[]
      const items = doc.blocks.map((b, i) => {
        const el = kids[i]
        const cs = el ? getComputedStyle(el) : null
        const h = el ? el.offsetHeight + parseFloat(cs!.marginTop) + parseFloat(cs!.marginBottom) : 0
        return { height: h, pageBreak: b.type === "pagebreak", keepWithNext: b.type === "heading", footnoteHeight: fnPer[i].length ? fnKids[i]?.offsetHeight ?? 0 : 0 }
      })
      const p = paginate(items, g.contentHeight)
      setPages(p)
      onLaidOut?.(p.length)
    }
    run()
    document.fonts?.ready.then(run)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, mode, g.contentHeight, g.contentWidth])

  const pageOf = useMemo(() => {
    const m = new Map<string, number>()
    pages?.forEach((p, k) => {
      for (let i = p.start; i < p.end; i++) m.set(doc.blocks[i].id, k + 1)
    })
    return m
  }, [pages, doc])
  const ctx = useMemo(() => createRenderContext(doc, pageOf), [doc, pageOf])

  const style = { ...themeVars(doc.meta) } as CSSProperties
  if (mode === "web") {
    const notes = [...ctx0.footnoteNo.entries()]
    return (
      <div className={`w2-doc w2-view w2-web ${doc.meta.numberedHeadings ? "w2-numbered" : ""} ${className ?? ""}`} style={style}>
        <article className="w2-web-article">
          {doc.meta.title && <h1 className="w2-doc-title">{doc.meta.title}</h1>}
          {doc.blocks.map((b) => (
            <BlockView key={b.id} block={b} ctx={ctx0} />
          ))}
          {notes.length > 0 && (
            <section className="w2-endnotes">
              <hr />
              {notes.map(([n, no]) => (
                <div key={no} className="w2-footnote">
                  <sup>{no}</sup> <Inlines content={n.content} ctx={ctx0} />
                </div>
              ))}
            </section>
          )}
        </article>
      </div>
    )
  }

  const total = pages?.length ?? 1
  const zone = (tpl: string | undefined, n: number, start: number) => {
    if (!tpl || (doc.meta.titlePage && n === 1)) return ["", "", ""]
    const sec = outline(doc).filter((o) => o.level === 1 && o.index <= start).pop()?.text
    return fillTemplate(tpl, { page: n, pages: total, meta: doc.meta, section: sec })
  }

  return (
    <div className={`w2-doc w2-view w2-print ${doc.meta.numberedHeadings ? "w2-numbered" : ""} ${className ?? ""}`} style={style}>
      {(pages ?? []).map((p, k) => {
        const fns = fnPer.slice(p.start, p.end).flat()
        const h = zone(doc.meta.header, k + 1, p.start)
        const f = zone(doc.meta.footer, k + 1, p.start)
        return (
          <section key={k} className="w2-sheet" style={{ width: g.width, height: g.height }}>
            <div className="w2-page-header" style={{ position: "absolute", top: 0, left: g.left, right: g.right, height: g.top }}>
              <span>{h[0]}</span>
              <span>{h[1]}</span>
              <span>{h[2]}</span>
            </div>
            <div className="w2-sheet-body" style={{ position: "absolute", top: g.top, left: g.left, width: g.contentWidth, height: g.contentHeight }}>
              {doc.blocks.slice(p.start, p.end).map((b) => (
                <BlockView key={b.id} block={b} ctx={ctx} />
              ))}
              {fns.length > 0 && (
                <div className="w2-page-footnotes" style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
                  {fns.map((n, i) => (
                    <div key={i} className="w2-footnote">
                      <sup>{ctx.footnoteNo.get(n)}</sup> <Inlines content={n.content} ctx={ctx} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="w2-page-footer" style={{ position: "absolute", bottom: 0, left: g.left, right: g.right, height: g.bottom }}>
              <span>{f[0]}</span>
              <span>{f[1]}</span>
              <span>{f[2]}</span>
            </div>
          </section>
        )
      })}
      <div className="w2-measure" aria-hidden>
        <div ref={measureRef} className="w2-sheet-body" style={{ width: g.contentWidth }}>
          {doc.blocks.map((b) => (
            <BlockView key={b.id} block={b} ctx={ctx0} />
          ))}
        </div>
        <div ref={fnRef} style={{ width: g.contentWidth }}>
          {fnPer.map((fns, i) => (
            <div key={i} className="w2-page-footnotes">
              {fns.map((n, k) => (
                <div key={k} className="w2-footnote">
                  <sup>{ctx0.footnoteNo.get(n)}</sup> <Inlines content={n.content} ctx={ctx0} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
