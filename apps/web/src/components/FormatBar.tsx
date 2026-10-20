import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Separator,
  Toggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alexandernygard/components"
import { useEditorState } from "@tiptap/react"
import { setTrackChanges } from "@word2/react"
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BarChart3Icon,
  BoldIcon,
  BookMarkedIcon,
  ChevronDownIcon,
  CodeIcon,
  Columns2Icon,
  FileDownIcon,
  FilePenLineIcon,
  FootprintsIcon,
  HighlighterIcon,
  ImageIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  InfoIcon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  ListTreeIcon,
  MessageSquarePlusIcon,
  MinusIcon,
  PlusIcon,
  QuoteIcon,
  Redo2Icon,
  SparklesIcon,
  StrikethroughIcon,
  SubscriptIcon,
  SuperscriptIcon,
  TableIcon,
  Trash2Icon,
  UnderlineIcon,
  Undo2Icon,
} from "lucide-react"
import { useEffect, type ReactNode } from "react"
import { QUICK_ACTIONS, TONES, askClaude } from "../ai/useAgent"
import { insert } from "../lib/actions"
import { useEditorRef } from "../lib/editor"
import { useStore } from "../store"
import { ask } from "./PromptDialog"

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function FormatBar() {
  const editor = useEditorRef((s) => s.editor)
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            code: e.isActive("code"),
            highlight: e.isActive("highlight"),
            sup: e.isActive("superscript"),
            sub: e.isActive("subscript"),
            link: e.isActive("link"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            task: e.isActive("taskList"),
            table: e.isActive("table"),
            align: (["center", "right", "justify"].find((a) => e.isActive({ textAlign: a })) ?? "left") as string,
            block: e.isActive("heading", { level: 1 })
              ? "h1"
              : e.isActive("heading", { level: 2 })
                ? "h2"
                : e.isActive("heading", { level: 3 })
                  ? "h3"
                  : e.isActive("heading", { level: 4 })
                    ? "h4"
                    : e.isActive("blockquote")
                      ? "quote"
                      : e.isActive("codeBlock")
                        ? "code"
                        : "p",
            empty: e.state.selection.empty,
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  })
  const refs = useStore((s) => s.doc.meta.references) ?? []
  const hasSel = useStore((s) => !!s.selection && !s.selection.empty)
  const tracking = useStore((s) => s.settings.trackChanges)
  const author = useStore((s) => s.settings.author)
  useEffect(() => {
    if (editor && !editor.isDestroyed) setTrackChanges(editor.view, { enabled: tracking, author: author.trim() || "you" })
  }, [editor, tracking, author])
  if (!editor || !st) return <div className="h-10 border-b bg-background" />
  const c = () => editor.chain().focus()

  const mark = (label: string, icon: ReactNode, active: boolean, run: () => void) => (
    <Tip label={label}>
      <Toggle size="sm" pressed={active} onPressedChange={run} aria-label={label}>
        {icon}
      </Toggle>
    </Tip>
  )

  const setBlock = (v: string) => {
    if (v === "p") c().setParagraph().run()
    else if (v.startsWith("h")) c().setHeading({ level: Number(v[1]) as 1 }).run()
    else if (v === "quote") c().toggleBlockquote().run()
    else if (v === "code") c().toggleCodeBlock().run()
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-2 [scrollbar-width:none]">
      <Tip label="Undo (⌘Z)">
        <Button variant="ghost" size="icon-sm" disabled={!st.canUndo} onClick={() => c().undo().run()} aria-label="Undo">
          <Undo2Icon />
        </Button>
      </Tip>
      <Tip label="Redo (⇧⌘Z)">
        <Button variant="ghost" size="icon-sm" disabled={!st.canRedo} onClick={() => c().redo().run()} aria-label="Redo">
          <Redo2Icon />
        </Button>
      </Tip>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <select aria-label="Block style" className="h-7 w-[118px] rounded-md border bg-background px-1.5 text-xs" value={st.block} onChange={(e) => setBlock(e.target.value)}>
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
        <option value="quote">Quote</option>
        <option value="code">Code block</option>
      </select>
      <Separator orientation="vertical" className="mx-1 h-5" />
      {mark("Bold (⌘B)", <BoldIcon />, st.bold, () => c().toggleBold().run())}
      {mark("Italic (⌘I)", <ItalicIcon />, st.italic, () => c().toggleItalic().run())}
      {mark("Underline (⌘U)", <UnderlineIcon />, st.underline, () => c().toggleUnderline().run())}
      {mark("Strikethrough", <StrikethroughIcon />, st.strike, () => c().toggleStrike().run())}
      {mark("Inline code", <CodeIcon />, st.code, () => c().toggleCode().run())}
      {mark("Highlight", <HighlighterIcon />, st.highlight, () => c().toggleHighlight().run())}
      {mark("Superscript", <SuperscriptIcon />, st.sup, () => c().toggleSuperscript().run())}
      {mark("Subscript", <SubscriptIcon />, st.sub, () => c().toggleSubscript().run())}
      {mark("Link", <LinkIcon />, st.link, () =>
        st.link
          ? c().unsetLink().run()
          : ask({ title: "Add link", placeholder: "https://…", submit: "Add link", onSubmit: (href) => c().setLink({ href }).run() }),
      )}
      <Separator orientation="vertical" className="mx-1 h-5" />
      {mark("Align left", <AlignLeftIcon />, st.align === "left", () => c().setTextAlign("left").run())}
      {mark("Center", <AlignCenterIcon />, st.align === "center", () => c().setTextAlign("center").run())}
      {mark("Align right", <AlignRightIcon />, st.align === "right", () => c().setTextAlign("right").run())}
      {mark("Justify", <AlignJustifyIcon />, st.align === "justify", () => c().setTextAlign("justify").run())}
      <Separator orientation="vertical" className="mx-1 h-5" />
      {mark("Bulleted list", <ListIcon />, st.bullet, () => c().toggleBulletList().run())}
      {mark("Numbered list", <ListOrderedIcon />, st.ordered, () => c().toggleOrderedList().run())}
      {mark("Checklist", <ListChecksIcon />, st.task, () => c().toggleTaskList().run())}
      <Tip label="Indent">
        <Button variant="ghost" size="icon-sm" onClick={() => c().sinkListItem(st.task ? "taskItem" : "listItem").run()} aria-label="Indent">
          <IndentIncreaseIcon />
        </Button>
      </Tip>
      <Tip label="Outdent">
        <Button variant="ghost" size="icon-sm" onClick={() => c().liftListItem(st.task ? "taskItem" : "listItem").run()} aria-label="Outdent">
          <IndentDecreaseIcon />
        </Button>
      </Tip>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <PlusIcon /> Insert <ChevronDownIcon className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuItem onSelect={() => insert.table()}>
            <TableIcon /> Table
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insert.chart()}>
            <BarChart3Icon /> Chart
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              ask({
                title: "Insert image",
                description: "Paste an image URL. (Drag & drop is not supported yet.)",
                placeholder: "https://…/image.png",
                submit: "Insert",
                onSubmit: (src) => insert.image(src),
              })
            }
          >
            <ImageIcon /> Image
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => insert.footnote()}>
            <FootprintsIcon /> Footnote
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <BookMarkedIcon /> Citation
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {refs.length === 0 && <DropdownMenuLabel className="text-xs font-normal">Add references in the front matter</DropdownMenuLabel>}
              {refs.map((r) => (
                <DropdownMenuItem key={r.id} onSelect={() => insert.cite(r.id)}>
                  {r.author ? `${r.author} (${r.year ?? "n.d."})` : r.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <InfoIcon /> Callout
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {["note", "tip", "warning", "danger"].map((v) => (
                <DropdownMenuItem key={v} onSelect={() => insert.callout(v)} className="capitalize">
                  {v}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={() => c().toggleBlockquote().run()}>
            <QuoteIcon /> Quote
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insert.columns()}>
            <Columns2Icon /> Two columns
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => insert.toc()}>
            <ListTreeIcon /> Table of contents
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insert.references()}>
            <BookMarkedIcon /> Bibliography
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insert.pageBreak()}>
            <FileDownIcon /> Page break
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insert.divider()}>
            <MinusIcon /> Divider
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tip label="Comment on selection">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={st.empty}
          aria-label="Add comment"
          onClick={() =>
            ask({ title: "Add comment", placeholder: "Write a comment… (mention @claude to ask Claude)", multiline: true, submit: "Comment", onSubmit: (t) => insert.comment(t) })
          }
        >
          <MessageSquarePlusIcon />
        </Button>
      </Tip>
      {st.table && (
        <>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <TableIcon /> Table <ChevronDownIcon className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => c().addRowBefore().run()}>Insert row above</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => c().addRowAfter().run()}>Insert row below</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => c().addColumnBefore().run()}>Insert column left</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => c().addColumnAfter().run()}>Insert column right</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => c().deleteRow().run()}>Delete row</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => c().deleteColumn().run()}>Delete column</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => c().toggleHeaderRow().run()}>Toggle header row</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  askClaude(QUICK_ACTIONS.chart.prompt, { display: "Chart this table", effort: "low" })
                }
              >
                <BarChart3Icon /> Chart this table with Claude
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => c().deleteTable().run()}>
                <Trash2Icon /> Delete table
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tip label={tracking ? `Tracking your changes as @${author || "you"}` : "Track changes: your edits become suggestions"}>
        <Toggle size="sm" pressed={tracking} onPressedChange={(v) => useStore.getState().updateSettings({ trackChanges: v })} aria-label="Track changes" className="gap-1 px-2 text-xs">
          <FilePenLineIcon /> <span className="hidden 2xl:inline">Track changes</span>
        </Toggle>
      </Tip>
      <div className="ml-auto pl-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <SparklesIcon /> {hasSel ? "Edit selection" : "Ask Claude"} <ChevronDownIcon className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {hasSel ? "Proposed as tracked changes on the selection" : "Select text first for rewrites"}
            </DropdownMenuLabel>
            {(["improve", "tighten", "expand", "grammar"] as const).map((k) => (
              <DropdownMenuItem key={k} disabled={!hasSel} onSelect={() => askClaude(QUICK_ACTIONS[k].prompt, { display: QUICK_ACTIONS[k].label, effort: "low" })}>
                {QUICK_ACTIONS[k].label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!hasSel}>Change tone</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {TONES.map((t) => (
                  <DropdownMenuItem key={t} className="capitalize" onSelect={() => askClaude(`Rewrite the selected text in a ${t} tone. Keep the facts.`, { display: `Make it ${t}`, effort: "low" })}>
                    {t}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            {(["summarize", "continue", "table", "chart"] as const).map((k) => (
              <DropdownMenuItem key={k} onSelect={() => askClaude(QUICK_ACTIONS[k].prompt, { display: QUICK_ACTIONS[k].label, effort: "low" })}>
                {QUICK_ACTIONS[k].label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => askClaude(QUICK_ACTIONS.comments.prompt, { display: QUICK_ACTIONS.comments.label })}>{QUICK_ACTIONS.comments.label}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => askClaude(QUICK_ACTIONS.review.prompt, { display: QUICK_ACTIONS.review.label })}>{QUICK_ACTIONS.review.label}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
