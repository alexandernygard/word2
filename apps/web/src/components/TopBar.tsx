import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Separator,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@alexandernygard/components"
import { wordCount } from "@word2/sdk"
import {
  BookOpenIcon,
  CodeIcon,
  Columns2Icon,
  DownloadIcon,
  EllipsisIcon,
  FileIcon,
  FileTextIcon,
  FolderOpenIcon,
  MoonIcon,
  PanelLeftIcon,
  PanelRightIcon,
  ScrollTextIcon,
  SearchIcon,
  Settings2Icon,
  StickyNoteIcon,
  SunIcon,
} from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { exportCleanMarkdown, exportDocxFile, exportSource, newDocument, openFile } from "../lib/actions"
import { WELCOME } from "../sample"
import { useStore } from "../store"
import { DriveFileButton, DriveLogo } from "@alexandernygard/drive/react"
import { drive, driveFileId, newDriveDocument, saveToDrive, useCollab } from "../lib/collab"
import { PageSetupDialog } from "./PageSetupDialog"
import { printDocument } from "./PrintPortal"

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function TopBar() {
  const view = useStore((s) => s.view)
  const layout = useStore((s) => s.layout)
  const page = useStore((s) => s.page)
  const doc = useStore((s) => s.doc)
  const zoom = useStore((s) => s.zoom)
  const reading = useStore((s) => s.reading)
  const words = useMemo(() => wordCount(doc), [doc])
  const fileRef = useRef<HTMLInputElement>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  const driveItem = useCollab((s) => s.item)
  const peers = useCollab((s) => s.peers)
  const live = useCollab((s) => s.status)

  const toggleDark = () => {
    const next = !dark
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("word2.theme", next ? "dark" : "light")
    setDark(next)
  }

  return (
    // Narrower than lg the view controls move into the File menu, which turns into "⋯" on a phone,
    // so the bar never outgrows the screen.
    <header className="flex h-12 min-w-0 shrink-0 items-center gap-1 border-b bg-background px-2 sm:gap-2">
      <Tip label="Toggle outline">
        <Button variant="ghost" size="icon-sm" onClick={() => useStore.setState((s) => ({ leftOpen: !s.leftOpen }))} aria-label="Toggle outline">
          <PanelLeftIcon />
        </Button>
      </Tip>
      <div className="hidden items-center gap-1.5 pr-1 sm:flex">
        <div className="grid size-6 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">w2</div>
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">word2</span>
      </div>
      <Separator orientation="vertical" className="hidden h-5 sm:block" />
      <input
        key={doc.meta.title ?? ""}
        defaultValue={doc.meta.title ?? ""}
        placeholder="Untitled document"
        aria-label="Document title"
        className="h-8 min-w-0 max-w-[22rem] flex-1 truncate rounded-md bg-transparent px-2 text-sm font-medium outline-none hover:bg-muted focus:bg-muted"
        onBlur={(e) => {
          const title = e.target.value
          if (title === (doc.meta.title ?? "")) return
          useStore.getState().updateMeta({ title })
          // In Drive, the title is also the file's name.
          if (driveFileId && title.trim()) void drive.update(driveFileId, { name: title.trim() }).then((item) => useCollab.setState({ item }), () => {})
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground lg:inline">{words.toLocaleString()} words</span>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
        <ToggleGroup type="single" size="sm" variant="outline" className="hidden md:flex" value={view} onValueChange={(v) => v && useStore.setState({ view: v as "split" })}>
          <ToggleGroupItem value="doc" aria-label="Document only">
            <FileTextIcon /> <span className="hidden xl:inline">Document</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="split" aria-label="Side by side">
            <Columns2Icon /> <span className="hidden xl:inline">Split</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="code" aria-label="Code only">
            <CodeIcon /> <span className="hidden xl:inline">Code</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" size="sm" variant="outline" className="hidden lg:flex" value={layout} onValueChange={(v) => v && useStore.setState({ layout: v as "print" })}>
          <ToggleGroupItem value="print" aria-label="Page layout">
            <StickyNoteIcon /> <span className="hidden xl:inline">Pages</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="web" aria-label="Web layout">
            <ScrollTextIcon /> <span className="hidden xl:inline">Web</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <Tip label={reading ? "Back to editing" : "Read-only preview (rendering library)"}>
          <Button variant={reading ? "default" : "outline"} size="icon-sm" className="hidden lg:inline-flex" aria-label="Preview" onClick={() => useStore.setState({ reading: !reading })}>
            <BookOpenIcon />
          </Button>
        </Tip>
        <select
          aria-label="Zoom"
          className="hidden h-7 rounded-md border bg-background px-1 text-xs lg:block"
          value={zoom}
          onChange={(e) => useStore.setState({ zoom: Number(e.target.value) })}
        >
          {[0, 0.5, 0.75, 0.9, 1, 1.25, 1.5].map((z) => (
            <option key={z} value={z}>
              {z === 0 ? "Fit" : `${Math.round(z * 100)}%`}
            </option>
          ))}
        </select>
        {layout === "print" && (
          <span className="hidden min-w-[88px] text-center text-xs tabular-nums text-muted-foreground xl:inline" aria-live="polite">
            Page {page.current} of {page.total}
          </span>
        )}
        <Separator orientation="vertical" className="hidden h-5 lg:block" />
        <Tip label="Page setup, styles & brief">
          <Button variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={() => setSetupOpen(true)} aria-label="Page setup">
            <Settings2Icon />
          </Button>
        </Tip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="File and more">
              <FileIcon className="hidden md:block" />
              <EllipsisIcon className="md:hidden" />
              <span className="hidden md:inline">File</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup className="md:hidden">
              <DropdownMenuRadioGroup value={view === "code" ? "code" : "doc"} onValueChange={(v) => useStore.setState({ view: v as "doc" })}>
                <DropdownMenuRadioItem value="doc">
                  <FileTextIcon /> Document
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="code">
                  <CodeIcon /> Code
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
            </DropdownMenuGroup>
            <DropdownMenuGroup className="lg:hidden">
              <DropdownMenuRadioGroup value={layout} onValueChange={(v) => useStore.setState({ layout: v as "print" })}>
                <DropdownMenuRadioItem value="print">
                  <StickyNoteIcon /> Page layout
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="web">
                  <ScrollTextIcon /> Web layout
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <SearchIcon /> Zoom
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={String(zoom)} onValueChange={(z) => useStore.setState({ zoom: Number(z) })}>
                    {[0, 0.5, 0.75, 0.9, 1, 1.25, 1.5].map((z) => (
                      <DropdownMenuRadioItem key={z} value={String(z)}>
                        {z === 0 ? "Fit" : `${Math.round(z * 100)}%`}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuCheckboxItem checked={reading} onCheckedChange={(v) => useStore.setState({ reading: v })}>
                Read-only preview
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onSelect={() => setSetupOpen(true)}>
                <Settings2Icon /> Page setup…
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuGroup className="md:hidden">
              <DropdownMenuItem onSelect={toggleDark}>
                {dark ? <SunIcon /> : <MoonIcon />} {dark ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="lg:hidden" />
            <DropdownMenuItem
              onSelect={() =>
                driveFileId
                  ? void newDriveDocument().catch((e) => toast.error("Couldn't create the document", { description: String(e?.message ?? e) }))
                  : newDocument()
              }
            >
              <FileIcon /> New document
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
              <FolderOpenIcon /> Open .md / .w2.md…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useStore.getState().setSource(WELCOME, "ui")}>
              <BookOpenIcon /> Load sample document
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Export</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => printDocument()}>
              <DownloadIcon /> PDF (print)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                exportDocxFile().then(
                  () => toast.success("Word document exported", { description: "Suggestions are tracked changes, comments are Word comments." }),
                  (e) => toast.error("Export failed", { description: String(e) }),
                )
              }
            >
              <DownloadIcon /> Word (.docx)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportSource()}>
              <DownloadIcon /> word2 source (.w2.md)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportCleanMarkdown()}>
              <DownloadIcon /> Markdown (canonical)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt,.w2,.w2.md"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) openFile(f)
            e.target.value = ""
          }}
        />
        <Separator orientation="vertical" className="hidden h-5 sm:block" />
        {driveFileId ? (
          <>
            {live !== "live" && live !== "off" && <span className="text-xs text-muted-foreground">{live === "connecting" ? "Connecting…" : live === "offline" ? "Offline" : ""}</span>}
            <DriveFileButton fileId={driveFileId} item={driveItem} peers={peers.map((p) => p.state.user)} onItemChange={(item) => useCollab.setState({ item })} />
          </>
        ) : (
          <Tip label="Save to Drive to share it with people and edit together">
            <Button
              variant="outline"
              size="sm"
              aria-label="Save to Drive"
              onClick={() =>
                saveToDrive().catch((e) =>
                  e?.signedOut ? (location.href = drive.loginUrl()) : toast.error("Couldn't save to Drive", { description: String(e?.message ?? e) }),
                )
              }
            >
              <DriveLogo size={16} /> <span className="hidden sm:inline">Save to Drive</span>
            </Button>
          </Tip>
        )}
        <Tip label={dark ? "Light mode" : "Dark mode"}>
          <Button variant="ghost" size="icon-sm" className="hidden md:inline-flex" onClick={toggleDark} aria-label="Toggle dark mode">
            {dark ? <SunIcon /> : <MoonIcon />}
          </Button>
        </Tip>
        <Tip label="Toggle Claude & review panel">
          <Button variant="ghost" size="icon-sm" onClick={() => useStore.setState((s) => ({ rightOpen: !s.rightOpen }))} aria-label="Toggle right panel">
            <PanelRightIcon />
          </Button>
        </Tip>
      </div>
      <PageSetupDialog open={setupOpen} onOpenChange={setSetupOpen} />
    </header>
  )
}
