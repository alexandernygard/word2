import { Badge } from "@alexandernygard/components"
import { CodeIcon } from "lucide-react"
import { useStore } from "../store"
import { CodeView } from "./CodeView"

export function CodePane() {
  const errors = useStore((s) => s.errors)
  const len = useStore((s) => s.source.length)
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <CodeIcon className="size-3.5" />
        <span className="font-medium text-foreground">document.w2.md</span>
        <span>{len.toLocaleString()} chars</span>
        {errors.length > 0 && (
          <Badge variant="warning" title={errors.map((e) => e.message).join("\n")}>
            {errors.length} warning{errors.length > 1 ? "s" : ""}
          </Badge>
        )}
        <span className="ml-auto hidden lg:inline">Edits here update the pages live</span>
      </div>
      <div className="min-h-0 flex-1">
        <CodeView />
      </div>
    </div>
  )
}
