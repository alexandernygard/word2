import {
  BarChart3Icon,
  BookMarkedIcon,
  CodeIcon,
  Columns2Icon,
  FileDownIcon,
  FootprintsIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  InfoIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  ListTreeIcon,
  MinusIcon,
  PilcrowIcon,
  QuoteIcon,
  SparklesIcon,
  TableIcon,
} from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { QUICK_ACTIONS, askClaude } from "../ai/useAgent"
import { insert } from "../lib/actions"
import { useEditorRef } from "../lib/editor"
import { ask } from "./PromptDialog"

type Item = { label: string; keywords: string; icon: ReactNode; run: () => void }

/** "/" at the start of an empty line opens a block menu. */
export function SlashMenu() {
  const editor = useEditorRef((s) => s.editor)
  const [state, setState] = useState<{ query: string; from: number; to: number; x: number; y: number } | null>(null)
  const [index, setIndex] = useState(0)

  const items: Item[] = useMemo(() => {
    const c = () => editor!.chain().focus()
    return [
      { label: "Text", keywords: "paragraph p", icon: <PilcrowIcon />, run: () => c().setParagraph().run() },
      { label: "Heading 1", keywords: "h1 title", icon: <Heading1Icon />, run: () => c().setHeading({ level: 1 }).run() },
      { label: "Heading 2", keywords: "h2 subtitle", icon: <Heading2Icon />, run: () => c().setHeading({ level: 2 }).run() },
      { label: "Heading 3", keywords: "h3", icon: <Heading3Icon />, run: () => c().setHeading({ level: 3 }).run() },
      { label: "Bulleted list", keywords: "ul bullet", icon: <ListIcon />, run: () => c().toggleBulletList().run() },
      { label: "Numbered list", keywords: "ol ordered", icon: <ListOrderedIcon />, run: () => c().toggleOrderedList().run() },
      { label: "Checklist", keywords: "todo task", icon: <ListChecksIcon />, run: () => c().toggleTaskList().run() },
      { label: "Quote", keywords: "blockquote", icon: <QuoteIcon />, run: () => c().toggleBlockquote().run() },
      { label: "Callout", keywords: "note tip warning", icon: <InfoIcon />, run: () => insert.callout("note") },
      { label: "Code block", keywords: "pre", icon: <CodeIcon />, run: () => c().toggleCodeBlock().run() },
      { label: "Table", keywords: "grid", icon: <TableIcon />, run: () => insert.table() },
      { label: "Chart", keywords: "graph bar line pie data", icon: <BarChart3Icon />, run: () => insert.chart() },
      { label: "Image", keywords: "picture photo", icon: <ImageIcon />, run: () => ask({ title: "Insert image", placeholder: "https://…", submit: "Insert", onSubmit: (s) => insert.image(s) }) },
      { label: "Footnote", keywords: "note", icon: <FootprintsIcon />, run: () => insert.footnote() },
      { label: "Two columns", keywords: "columns layout", icon: <Columns2Icon />, run: () => insert.columns() },
      { label: "Table of contents", keywords: "toc outline", icon: <ListTreeIcon />, run: () => insert.toc() },
      { label: "Bibliography", keywords: "references citations", icon: <BookMarkedIcon />, run: () => insert.references() },
      { label: "Page break", keywords: "new page", icon: <FileDownIcon />, run: () => insert.pageBreak() },
      { label: "Divider", keywords: "hr rule line", icon: <MinusIcon />, run: () => insert.divider() },
      { label: "Continue writing", keywords: "ai claude more", icon: <SparklesIcon />, run: () => askClaude(QUICK_ACTIONS.continue.prompt, { display: "Continue writing", effort: "low" }) },
      {
        label: "Ask Claude to write…",
        keywords: "ai claude draft generate",
        icon: <SparklesIcon />,
        run: () =>
          ask({
            title: "What should Claude write here?",
            placeholder: "e.g. a paragraph on pricing risks, with a small table",
            multiline: true,
            submit: "Write",
            onSubmit: (t) => askClaude(`Insert new content after the block the cursor is in: ${t}`, { display: t }),
          }),
      },
    ]
  }, [editor])

  const filtered = state ? items.filter((i) => (i.label + " " + i.keywords).toLowerCase().includes(state.query.toLowerCase())) : []

  useEffect(() => {
    if (!editor) return
    const check = () => {
      const { selection } = editor.state
      const { $from, empty } = selection
      if (!empty || $from.parent.type.name !== "paragraph") return setState(null)
      const text = $from.parent.textBetween(0, $from.parentOffset, "\0", "\0")
      const m = /^\/([\w ]{0,24})$/.exec(text)
      if (!m) return setState(null)
      const coords = editor.view.coordsAtPos($from.pos)
      const host = editor.view.dom.closest(".w2-desk")!.getBoundingClientRect()
      const scroller = editor.view.dom.closest(".w2-desk") as HTMLElement
      setState({ query: m[1], from: $from.start(), to: $from.pos, x: coords.left - host.left + scroller.scrollLeft, y: coords.bottom - host.top + scroller.scrollTop + 6 })
    }
    editor.on("update", check)
    editor.on("selectionUpdate", check)
    return () => {
      editor.off("update", check)
      editor.off("selectionUpdate", check)
    }
  }, [editor])

  useEffect(() => setIndex(0), [state?.query])

  useEffect(() => {
    if (!editor || !state) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, filtered.length - 1))
      else if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0))
      else if (e.key === "Enter" && filtered[index]) choose(filtered[index])
      else if (e.key === "Escape") setState(null)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    const dom = editor.view.dom
    dom.addEventListener("keydown", onKey, true)
    return () => dom.removeEventListener("keydown", onKey, true)
  })

  const choose = (item: Item) => {
    if (!editor || !state) return
    editor.chain().focus().deleteRange({ from: state.from, to: state.to }).run()
    setState(null)
    item.run()
  }

  if (!state || filtered.length === 0) return null
  return (
    <div
      className="absolute z-30 max-h-80 w-64 overflow-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.preventDefault()}
      role="listbox"
    >
      {filtered.map((item, i) => (
        <button
          key={item.label}
          role="option"
          aria-selected={i === index}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground ${i === index ? "bg-accent" : ""}`}
          onMouseEnter={() => setIndex(i)}
          onClick={() => choose(item)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  )
}
