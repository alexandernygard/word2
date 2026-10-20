import { Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@alexandernygard/components"
import { listComments, listSuggestions, resolveAll, resolveComment, resolveSuggestion } from "@word2/sdk"
import { CheckCheckIcon, CheckIcon, SparklesIcon, XIcon } from "lucide-react"
import { useMemo } from "react"
import { QUICK_ACTIONS, askClaude } from "../ai/useAgent"
import { scrollToBlock } from "../lib/editor"
import { useStore } from "../store"

export function ReviewPanel() {
  const doc = useStore((s) => s.doc)
  const suggestions = useMemo(() => listSuggestions(doc), [doc])
  const comments = useMemo(() => listComments(doc), [doc])
  const apply = (next: typeof doc, label: string) => useStore.getState().applyDoc(next, "ui", { label })

  if (!suggestions.length && !comments.length)
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>Nothing to review</EmptyTitle>
          <EmptyDescription>Claude's edits show up here as suggestions you can accept or reject one by one. Comments too.</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={() => askClaude(QUICK_ACTIONS.review.prompt, { display: QUICK_ACTIONS.review.label })}>
          <SparklesIcon /> Ask Claude to review
        </Button>
      </Empty>
    )

  return (
    <div className="space-y-5 p-3">
      {suggestions.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-medium">Suggestions</h3>
            <Badge variant="secondary">{suggestions.length}</Badge>
            <div className="ml-auto flex gap-1">
              <Button size="xs" variant="outline" onClick={() => apply(resolveAll(doc, true), "Accept all")}>
                <CheckCheckIcon /> Accept all
              </Button>
              <Button size="xs" variant="ghost" onClick={() => apply(resolveAll(doc, false), "Reject all")}>
                Reject all
              </Button>
            </div>
          </div>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s.sid} className="rounded-lg border bg-card p-2.5 text-sm">
                <button className="block w-full text-left" onClick={() => scrollToBlock(s.blockId)}>
                  <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{s.author ? `@${s.author}` : "Suggestion"}</span>
                    <span>· {s.scope === "block" ? `${s.kind} block` : s.kind}</span>
                  </div>
                  {s.note && <div className="mb-1.5 text-[13px]">{s.note}</div>}
                  {s.deleted && <div className="line-clamp-2 text-xs text-red-700 line-through dark:text-red-300">{s.deleted}</div>}
                  {s.inserted && <div className="line-clamp-3 text-xs text-green-800 dark:text-green-300">{s.inserted}</div>}
                </button>
                <div className="mt-2 flex gap-1.5">
                  <Button size="xs" onClick={() => apply(resolveSuggestion(doc, s.sid, true), "Accept suggestion")} aria-label="Accept suggestion">
                    <CheckIcon /> Accept
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => apply(resolveSuggestion(doc, s.sid, false), "Reject suggestion")} aria-label="Reject suggestion">
                    <XIcon /> Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {comments.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-medium">Comments</h3>
            <Badge variant="secondary">{comments.length}</Badge>
            {comments.some((c) => c.thread.some((m) => m.text.includes("@claude"))) && (
              <Button size="xs" variant="outline" className="ml-auto" onClick={() => askClaude(QUICK_ACTIONS.comments.prompt, { display: QUICK_ACTIONS.comments.label })}>
                <SparklesIcon /> Address @claude
              </Button>
            )}
          </div>
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-lg border bg-card p-2.5 text-sm">
                <button className="mb-1.5 block w-full truncate text-left text-xs text-muted-foreground italic" onClick={() => scrollToBlock(c.blockId)}>
                  “{c.quote}”
                </button>
                {c.thread.map((m, i) => (
                  <p key={i} className="mb-1 text-[13px]">
                    <span className="font-medium">{m.author ? `@${m.author}` : "Comment"}</span> {m.text}
                  </p>
                ))}
                <div className="mt-2 flex gap-1.5">
                  <Button size="xs" variant="outline" onClick={() => apply(resolveComment(doc, c.id), "Resolve comment")}>
                    <CheckIcon /> Resolve
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      askClaude(`Address comment ${c.id} on "${c.quote}": ${c.thread.map((m) => m.text).join(" / ")}. Make the edit, then reply and resolve it.`, {
                        display: `Address comment: “${c.thread[0]?.text.slice(0, 60)}”`,
                        effort: "low",
                      })
                    }
                  >
                    <SparklesIcon /> Ask Claude
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
