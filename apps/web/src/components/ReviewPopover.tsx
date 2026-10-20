import { Button, Textarea } from "@alexandernygard/components"
import type { ReviewTarget } from "@word2/react"
import { listComments, listSuggestions, replyToComment, resolveComment, resolveSuggestion } from "@word2/sdk"
import { CheckIcon, SparklesIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { askClaude } from "../ai/useAgent"
import { useStore } from "../store"

/** Floating card for a clicked suggestion or comment. */
export function ReviewPopover({ target, onClose }: { target: NonNullable<ReviewTarget>; onClose: () => void }) {
  const doc = useStore((s) => s.doc)
  const [reply, setReply] = useState("")
  const desk = document.querySelector(".w2-desk")
  const host = desk?.getBoundingClientRect()
  if (!host || !desk) return null
  const pos = { left: Math.max(8, target.rect.left - host.left + desk.scrollLeft), top: target.rect.bottom - host.top + desk.scrollTop + 6 }
  const apply = (fn: (d: typeof doc) => typeof doc, label: string) => {
    useStore.getState().applyDoc(fn(useStore.getState().doc), "ui", { label })
    onClose()
  }

  let body: React.ReactNode = null
  if (target.sid) {
    const s = listSuggestions(doc).find((x) => x.sid === target.sid)
    if (!s) return null
    body = (
      <>
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{s.author ? `@${s.author}` : "Suggestion"}</span>
          <span>{s.kind === "replace" ? "replace" : s.kind}</span>
        </div>
        {s.note && <p className="mb-2 text-sm">{s.note}</p>}
        <div className="mb-3 space-y-1 text-xs">
          {s.deleted && <div className="line-clamp-3 rounded bg-red-500/10 px-1.5 py-1 text-red-700 line-through dark:text-red-300">{s.deleted}</div>}
          {s.inserted && <div className="line-clamp-3 rounded bg-green-600/10 px-1.5 py-1 text-green-800 dark:text-green-300">{s.inserted}</div>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => apply((d) => resolveSuggestion(d, s.sid, true), "Accept suggestion")}>
            <CheckIcon /> Accept
          </Button>
          <Button size="sm" variant="outline" onClick={() => apply((d) => resolveSuggestion(d, s.sid, false), "Reject suggestion")}>
            <XIcon /> Reject
          </Button>
        </div>
      </>
    )
  } else if (target.cid) {
    const c = listComments(doc).find((x) => x.id === target.cid)
    if (!c) return null
    body = (
      <>
        <div className="mb-2 space-y-2">
          {c.thread.map((m, i) => (
            <div key={i} className="text-sm">
              <span className="font-medium">{m.author ? `@${m.author}` : "Comment"}</span> <span className="text-muted-foreground">{m.text}</span>
            </div>
          ))}
        </div>
        <Textarea rows={2} value={reply} placeholder="Reply…" onChange={(e) => setReply(e.target.value)} className="mb-2 text-sm" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!reply.trim()} onClick={() => apply((d) => replyToComment(d, c.id, { author: "you", text: reply.trim() }), "Reply")}>
            Reply
          </Button>
          <Button size="sm" variant="outline" onClick={() => apply((d) => resolveComment(d, c.id), "Resolve comment")}>
            <CheckIcon /> Resolve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onClose()
              askClaude(`Address comment ${c.id} ("${c.thread.map((m) => m.text).join(" / ")}") on the text "${c.quote}". Make the edit, then reply and resolve it.`, {
                display: `Address comment: “${c.thread[0]?.text.slice(0, 60)}”`,
                effort: "low",
              })
            }}
          >
            <SparklesIcon /> Ask Claude
          </Button>
        </div>
      </>
    )
  }

  return (
    <div
      className="absolute z-40 w-80 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl"
      style={pos}
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Review"
    >
      {body}
    </div>
  )
}
