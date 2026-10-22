import { ResizableHandle, ResizablePanel, ResizablePanelGroup, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, useIsMobile } from "@alexandernygard/components"
import { AssistantPanel } from "./components/AssistantPanel"
import { CodePane } from "./components/CodePane"
import { DocPane } from "./components/DocPane"
import { OutlinePanel } from "./components/OutlinePanel"
import { PrintPortal } from "./components/PrintPortal"
import { PromptDialog } from "./components/PromptDialog"
import { ReviewPanel } from "./components/ReviewPanel"
import { RightPanel } from "./components/RightPanel"
import { TopBar } from "./components/TopBar"
import { useEffect } from "react"
import { DriveNotice } from "./components/DriveNotice"
import { driveFileId, startCollab } from "./lib/collab"
import { useStore } from "./store"

export function App() {
  useEffect(() => (driveFileId ? startCollab(driveFileId) : undefined), [])
  const isMobile = useIsMobile()
  // A phone has room for one pane, so split shows the document there.
  const view = useStore((s) => (isMobile && s.view === "split" ? "doc" : s.view))
  const leftOpen = useStore((s) => s.leftOpen)
  const rightOpen = useStore((s) => s.rightOpen)
  const right = <RightPanel assistant={<AssistantPanel />} review={<ReviewPanel />} />
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <DriveNotice />
      <div className="flex min-h-0 flex-1">
        {leftOpen && !isMobile && (
          <aside className="w-60 shrink-0 border-r bg-background">
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
        {rightOpen && !isMobile && <aside className="w-[min(400px,40vw)] shrink-0 border-l bg-background">{right}</aside>}
      </div>
      {/* On a phone the side panels slide over the document instead. */}
      {isMobile && (
        <>
          <Sheet open={leftOpen} onOpenChange={(o) => useStore.setState({ leftOpen: o })}>
            <SheetContent side="left" className="gap-0 p-0 pt-10 data-[side=left]:w-[85vw]">
              <SheetHeader className="sr-only">
                <SheetTitle>Outline</SheetTitle>
                <SheetDescription>The document's headings</SheetDescription>
              </SheetHeader>
              <OutlinePanel />
            </SheetContent>
          </Sheet>
          <Sheet open={rightOpen} onOpenChange={(o) => useStore.setState({ rightOpen: o })}>
            <SheetContent side="right" className="gap-0 p-0 pt-10 data-[side=right]:w-[92vw]">
              <SheetHeader className="sr-only">
                <SheetTitle>Claude and review</SheetTitle>
                <SheetDescription>Ask Claude, review suggestions and comments, and see history</SheetDescription>
              </SheetHeader>
              {right}
            </SheetContent>
          </Sheet>
        </>
      )}
      <PrintPortal />
      <PromptDialog />
    </div>
  )
}
