import { Button } from "@alexandernygard/components"
import { listComments, listSuggestions, moveSection, outline, sectionRange, shiftSection, type OutlineItem } from "@word2/sdk"
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, GripVerticalIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { scrollToBlock } from "../lib/editor"
import { useStore } from "../store"

export function OutlinePanel() {
  const doc = useStore((s) => s.doc)
  const pageOf = useStore((s) => s.pageOf)
  const layout = useStore((s) => s.layout)
  const activeBlockId = useStore((s) => s.activeBlockId)
  const items = useMemo(() => outline(doc), [doc])
  const counts = useMemo(() => ({ s: listSuggestions(doc).length, c: listComments(doc).length }), [doc])
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const activeIndex = doc.blocks.findIndex((b) => b.id === activeBlockId)
  const current = [...items].reverse().find((o) => o.index <= activeIndex)?.id

  const apply = (next: typeof doc, label: string) => useStore.getState().applyDoc(next, "ui", { label })
  const prevSibling = (o: OutlineItem) => {
    const before = items.filter((x) => x.index < o.index)
    for (let k = before.length - 1; k >= 0; k--) {
      if (before[k].level < o.level) return null
      if (before[k].level === o.level) return before[k]
    }
    return null
  }
  const nextSibling = (o: OutlineItem) => {
    const r = sectionRange(doc.blocks, o.id)
    if (!r) return null
    const n = items.find((x) => x.index === r[1])
    return n && n.level === o.level ? n : null
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center border-b px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Outline</div>
      <nav className="min-h-0 flex-1 overflow-auto p-1.5" aria-label="Document outline">
        {items.length === 0 && <p className="p-3 text-sm text-muted-foreground">Headings appear here. Drag them to reorder sections.</p>}
        {items.map((o) => {
          const prev = prevSibling(o)
          const next = nextSibling(o)
          return (
            <div
              key={o.id}
              draggable
              onDragStart={(e) => {
                setDrag(o.id)
                e.dataTransfer.effectAllowed = "move"
              }}
              onDragEnd={() => {
                setDrag(null)
                setOver(null)
              }}
              onDragOver={(e) => {
                if (!drag || drag === o.id) return
                e.preventDefault()
                setOver(o.id)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (drag && drag !== o.id) apply(moveSection(doc, drag, o.id), "Move section")
                setDrag(null)
                setOver(null)
              }}
              className={`group relative flex items-center gap-1 rounded-md py-1 pr-1 text-sm ${current === o.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"} ${over === o.id ? "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded before:bg-highlight" : ""} ${drag === o.id ? "opacity-40" : ""}`}
              style={{ paddingLeft: 4 + (o.level - 1) * 14 }}
            >
              <GripVerticalIcon className="size-3.5 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100" />
              <button className={`min-w-0 flex-1 truncate text-left ${o.level === 1 ? "font-medium" : "text-muted-foreground group-hover:text-foreground"}`} onClick={() => scrollToBlock(o.id, true)} title={o.text}>
                {doc.meta.numberedHeadings && <span className="mr-1.5 text-xs text-muted-foreground tabular-nums">{o.number}</span>}
                {o.text || <span className="italic">Untitled</span>}
              </button>
              <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
                <Button variant="ghost" size="icon-xs" aria-label="Move section up" disabled={!prev} onClick={() => prev && apply(moveSection(doc, o.id, prev.id), "Move section")}>
                  <ArrowUpIcon />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label="Move section down" disabled={!next} onClick={() => next && apply(moveSection(doc, next.id, o.id), "Move section")}>
                  <ArrowDownIcon />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label="Promote" disabled={o.level === 1} onClick={() => apply(shiftSection(doc, o.id, -1), "Promote section")}>
                  <ArrowLeftIcon />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label="Demote" disabled={o.level === 6} onClick={() => apply(shiftSection(doc, o.id, 1), "Demote section")}>
                  <ArrowRightIcon />
                </Button>
              </span>
              {layout === "print" && <span className="w-5 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums group-hover:hidden">{pageOf.get(o.id) ?? ""}</span>}
            </div>
          )
        })}
        {drag && (
          <div
            className="mt-1 rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              apply(moveSection(doc, drag, null), "Move section")
              setDrag(null)
            }}
          >
            Drop here to move to the end
          </div>
        )}
      </nav>
      <div className="flex shrink-0 gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span>{counts.s} suggestions</span>
        <span>{counts.c} comments</span>
      </div>
    </div>
  )
}
