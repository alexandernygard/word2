import { DocumentEditor, DocumentView, Inlines, createRenderContext, pageGeometry, type ReviewTarget } from "@word2/react"
import { footnotes, type Block } from "@word2/sdk"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEditorRef } from "../lib/editor"
import { useStore } from "../store"
import { FormatBar } from "./FormatBar"
import { ReviewPopover } from "./ReviewPopover"
import { SlashMenu } from "./SlashMenu"

function Endnotes() {
  const doc = useStore((s) => s.doc)
  const notes = useMemo(() => footnotes(doc), [doc])
  const ctx = useMemo(() => createRenderContext(doc), [doc])
  if (!notes.length) return null
  return (
    <div className="w2-doc mx-auto -mt-16 mb-16 max-w-[760px] rounded-b-[14px] bg-white px-16 pb-10 text-[0.85em]" style={{ fontFamily: "var(--w2-body-font)" }}>
      <hr className="mb-3 border-t" />
      {notes.map((n, i) => (
        <div key={i} className="w2-footnote">
          <sup>{i + 1}</sup> <Inlines content={n.content} ctx={ctx} />
        </div>
      ))}
    </div>
  )
}

export function DocPane() {
  const doc = useStore((s) => s.doc)
  const origin = useStore((s) => s.origin)
  const layout = useStore((s) => s.layout)
  const zoom = useStore((s) => s.zoom)
  const reading = useStore((s) => s.reading)
  const activeBlockId = useStore((s) => s.activeBlockId)
  const activeFrom = useStore((s) => s.activeFrom)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [review, setReview] = useState<ReviewTarget>(null)
  const [paneWidth, setPaneWidth] = useState(1000)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPaneWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const pageWidth = pageGeometry(doc.meta).width
  const effectiveZoom = zoom === 0 ? (layout === "print" ? Math.min(1, Math.max(0.4, (paneWidth - 24) / (pageWidth + 48))) : 1) : zoom

  const onChange = useCallback((blocks: Block[]) => useStore.getState().setBlocks(blocks), [])

  const updatePage = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const gaps = el.querySelectorAll(".w2-page-gap, .w2-sheet")
    const isSheets = !!el.querySelector(".w2-sheet")
    const mid = el.getBoundingClientRect().top + el.clientHeight * 0.35
    let current = isSheets ? 0 : 1
    gaps.forEach((g) => {
      if (g.getBoundingClientRect().top < mid) current++
    })
    const total = isSheets ? gaps.length : gaps.length + 1
    const p = useStore.getState().page
    if (p.current !== current || p.total !== total) useStore.setState({ page: { current: Math.max(1, Math.min(current, total)), total } })
  }, [])

  useEffect(() => {
    const id = setTimeout(updatePage, 200)
    return () => clearTimeout(id)
  })

  return (
    <div className="flex h-full flex-col">
      {!reading && <FormatBar />}
      <div ref={scrollRef} className="w2-desk relative min-h-0 flex-1 overflow-auto" onScroll={updatePage} onMouseDown={() => review && setReview(null)}>
        <div style={{ zoom: effectiveZoom }}>
          {reading ? (
            <DocumentView doc={doc} mode={layout} onLaidOut={() => setTimeout(updatePage, 50)} />
          ) : (
            <>
              <DocumentEditor
                doc={doc}
                onChange={onChange}
                mode={layout}
                undoableSync={origin !== "code" && origin !== "remote"}
                activeBlockId={activeFrom === "code" ? activeBlockId : null}
                followActive={activeFrom === "code"}
                onSelectionChange={(sel) => {
                  useStore.setState({ selection: sel })
                  useStore.getState().setActive(sel.headBlockId, "editor")
                }}
                onReady={(editor, api) => useEditorRef.setState({ editor, api })}
                onReview={(t) => setReview(t)}
                onLayout={(l) => {
                  useStore.setState({ pageOf: l.pageOf })
                  updatePage()
                }}
              />
              {layout === "web" && <Endnotes />}
            </>
          )}
        </div>
        {!reading && <SlashMenu />}
        {review && <ReviewPopover target={review} onClose={() => setReview(null)} />}
      </div>
    </div>
  )
}
