import { DocumentView } from "@word2/react"
import { pageDimensions, pageSetup } from "@word2/sdk"
import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { create } from "zustand"
import { useStore } from "../store"

export const usePrint = create<{ printing: boolean }>(() => ({ printing: false }))

export function printDocument() {
  usePrint.setState({ printing: true })
}

/** Renders the read-only paged view into #print-root and opens the browser's print dialog (Save as PDF). */
export function PrintPortal() {
  const printing = usePrint((s) => s.printing)
  const doc = useStore((s) => s.doc)
  const printed = useRef(false)
  useEffect(() => {
    if (printing) printed.current = false
  }, [printing])
  useEffect(() => {
    const done = () => usePrint.setState({ printing: false })
    window.addEventListener("afterprint", done)
    return () => window.removeEventListener("afterprint", done)
  }, [])
  if (!printing) return null
  const d = pageDimensions(pageSetup(doc.meta))
  return createPortal(
    <>
      <style>{`@page { size: ${d.width}mm ${d.height}mm; margin: 0 }`}</style>
      <DocumentView
        doc={doc}
        mode="print"
        onLaidOut={() => {
          if (printed.current) return
          printed.current = true
          setTimeout(() => window.print(), 600)
        }}
      />
    </>,
    document.getElementById("print-root")!,
  )
}
