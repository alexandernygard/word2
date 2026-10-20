import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@alexandernygard/components"
import { AssistantPanel } from "./components/AssistantPanel"
import { CodePane } from "./components/CodePane"
import { DocPane } from "./components/DocPane"
import { OutlinePanel } from "./components/OutlinePanel"
import { PrintPortal } from "./components/PrintPortal"
import { PromptDialog } from "./components/PromptDialog"
import { ReviewPanel } from "./components/ReviewPanel"
import { RightPanel } from "./components/RightPanel"
import { TopBar } from "./components/TopBar"
import { useStore } from "./store"

export function App() {
  const view = useStore((s) => s.view)
  const leftOpen = useStore((s) => s.leftOpen)
  const rightOpen = useStore((s) => s.rightOpen)
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <aside className="hidden w-60 shrink-0 border-r bg-background md:block">
            <OutlinePanel />
          </aside>
        )}
        <main className="min-w-0 flex-1">
          <ResizablePanelGroup orientation="horizontal" key={view}>
            {view !== "code" && (
              <ResizablePanel id="doc" defaultSize={view === "split" ? "58%" : "100%"} minSize="30%">
                <DocPane />
              </ResizablePanel>
            )}
            {view === "split" && <ResizableHandle withHandle />}
            {view !== "doc" && (
              <ResizablePanel id="code" defaultSize={view === "split" ? "42%" : "100%"} minSize="20%">
                <CodePane />
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </main>
        {rightOpen && (
          <aside className="w-[min(400px,40vw)] shrink-0 border-l bg-background">
            <RightPanel assistant={<AssistantPanel />} review={<ReviewPanel />} />
          </aside>
        )}
      </div>
      <PrintPortal />
      <PromptDialog />
    </div>
  )
}
