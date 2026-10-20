import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from "@alexandernygard/components"
import { listComments, listSuggestions } from "@word2/sdk"
import { HistoryIcon, MessageSquareIcon, SparklesIcon } from "lucide-react"
import { useMemo, type ReactNode } from "react"
import { useStore } from "../store"
import { HistoryPanel } from "./HistoryPanel"

export function RightPanel({ assistant, review }: { assistant: ReactNode; review: ReactNode }) {
  const tab = useStore((s) => s.rightTab)
  const doc = useStore((s) => s.doc)
  const count = useMemo(() => listSuggestions(doc).length + listComments(doc).length, [doc])
  return (
    <Tabs value={tab} onValueChange={(v) => useStore.setState({ rightTab: v as "assistant" })} className="flex h-full flex-col gap-0">
      <div className="flex h-11 items-center border-b px-3">
        <TabsList className="w-full">
          <TabsTrigger value="assistant" className="flex-1">
            <SparklesIcon /> Claude
          </TabsTrigger>
          <TabsTrigger value="review" className="flex-1">
            <MessageSquareIcon /> Review
            {count > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
                {count}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1">
            <HistoryIcon /> History
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="assistant" className="min-h-0 flex-1">
        {assistant}
      </TabsContent>
      <TabsContent value="review" className="min-h-0 flex-1 overflow-auto">
        {review}
      </TabsContent>
      <TabsContent value="history" className="min-h-0 flex-1 overflow-auto">
        <HistoryPanel />
      </TabsContent>
    </Tabs>
  )
}
