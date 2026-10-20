import { Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@alexandernygard/components"
import { BlockView, createRenderContext } from "@word2/react"
import { blocksText, contentKey, listSuggestions, parse, resolveAll, suggestBlocks, type Block } from "@word2/sdk"
import { ArrowLeftIcon, HistoryIcon, PencilIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"
import { deleteVersion, renameVersion, restoreVersion, saveVersion, useVersions, type Version } from "../lib/versions"
import { useStore } from "../store"
import { ask } from "./PromptDialog"

const KIND_LABEL: Record<Version["kind"], string> = { manual: "saved", auto: "auto", claude: "before Claude", restore: "before restore" }

function when(at: number) {
  const d = new Date(at)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/**
 * Block-level diff: pair old and new blocks by word overlap (so an inserted paragraph
 * doesn't get compared with the one it pushed down), then let suggestBlocks mark
 * the words that changed inside each pair.
 */
function diffBlocks(a: Block[], b: Block[]): Block[] {
  const cache = new Map<Block, Set<string>>()
  const words = (x: Block) => {
    let w = cache.get(x)
    if (!w) cache.set(x, (w = new Set(blocksText([x]).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])))
    return w
  }
  const similar = (x: Block, y: Block) => {
    if (contentKey(x) === contentKey(y)) return true
    const A = words(x)
    const B = words(y)
    if (!A.size || !B.size) return false
    let n = 0
    A.forEach((w) => B.has(w) && n++)
    return n / Math.max(A.size, B.size) >= 0.4
  }
  const out: Block[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const o = a[i]
    const n = b[j]
    if (o && n && similar(o, n)) {
      out.push(...suggestBlocks([o], [n]))
      i++
      j++
      continue
    }
    const oldLater = n ? a.slice(i + 1, i + 8).findIndex((x) => similar(x, n)) : -1
    const newLater = o ? b.slice(j + 1, j + 8).findIndex((y) => similar(o, y)) : -1
    if (!n || (oldLater >= 0 && (newLater < 0 || oldLater <= newLater))) {
      out.push(...suggestBlocks([o], []))
      i++
    } else if (!o || newLater >= 0) {
      out.push(...suggestBlocks([], [n]))
      j++
    } else {
      out.push(...suggestBlocks([o], [n]))
      i++
      j++
    }
  }
  return out
}

/** Block-level diff of a version against the current document, as tracked suggestions (only changed blocks shown). */
function VersionDiff({ version }: { version: Version }) {
  const doc = useStore((s) => s.doc)
  const { blocks, changes } = useMemo(() => {
    // compare the documents as they read, with pending suggestions applied
    const old = resolveAll(parse(version.source, doc).doc, true)
    const diff = diffBlocks(old.blocks, resolveAll(doc, true).blocks)
    return { blocks: diff, changes: listSuggestions({ ...doc, blocks: diff }).length }
  }, [version, doc])
  const ctx = useMemo(() => createRenderContext(doc), [doc])
  const changed = (b: Block) => listSuggestions({ meta: {}, blocks: [b] }).length > 0

  if (!changes) return <p className="px-1 text-sm text-muted-foreground">Same as the current document.</p>
  // changed blocks, with gaps of unchanged blocks collapsed
  const rows: ({ gap: number } | { block: Block })[] = []
  for (const b of blocks) {
    if (changed(b)) rows.push({ block: b })
    else {
      const last = rows[rows.length - 1]
      if (last && "gap" in last) last.gap++
      else rows.push({ gap: 1 })
    }
  }
  return (
    <div>
      <p className="mb-2 px-1 text-xs text-muted-foreground">
        {changes} change{changes === 1 ? "" : "s"} from this version to now: <span className="text-red-700 line-through dark:text-red-300">removed</span>,{" "}
        <span className="text-green-800 dark:text-green-300">added</span> (pending suggestions shown as accepted).
      </p>
      <div className="w2-doc w2-history-diff rounded-lg border bg-white p-3 text-[13px] leading-snug text-black">
        {rows.map((r, i) =>
          "gap" in r ? (
            <div key={i} className="my-2 text-center font-sans text-[11px] text-neutral-400">
              ⋯ {r.gap} unchanged block{r.gap === 1 ? "" : "s"} ⋯
            </div>
          ) : (
            <BlockView key={i} block={r.block} ctx={ctx} />
          ),
        )}
      </div>
    </div>
  )
}

export function HistoryPanel() {
  const versions = useVersions((s) => s.versions)
  const [selected, setSelected] = useState<string | null>(null)
  const sel = versions.find((v) => v.id === selected)

  const save = () =>
    ask({ title: "Save version", placeholder: "Version name", initial: `Version ${versions.filter((v) => v.kind === "manual").length + 1}`, submit: "Save", onSubmit: (n) => saveVersion(n) })

  if (sel)
    return (
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-1">
          <Button size="icon-xs" variant="ghost" aria-label="Back to versions" onClick={() => setSelected(null)}>
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{sel.name}</div>
            <div className="text-xs text-muted-foreground">{when(sel.at)}</div>
          </div>
          <Button size="xs" variant="outline" onClick={() => (restoreVersion(sel.id), setSelected(null))}>
            <RotateCcwIcon /> Restore
          </Button>
        </div>
        <VersionDiff version={sel} />
      </div>
    )

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Versions</h3>
        <Button size="xs" className="ml-auto" onClick={save}>
          <SaveIcon /> Save version
        </Button>
      </div>
      {!versions.length ? (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyTitle>No versions yet</EmptyTitle>
            <EmptyDescription>Versions are saved every few minutes while you edit, and before every Claude turn. Save one yourself any time.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => (
            <li key={v.id} className="group flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-sm hover:bg-accent/50">
              <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(v.id)} aria-label={`Compare ${v.name}`}>
                <div className="flex items-center gap-1.5">
                  <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{v.name}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {when(v.at)}
                  {v.kind !== "manual" && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {KIND_LABEL[v.kind]}
                    </Badge>
                  )}
                </div>
              </button>
              <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="icon-xs" variant="ghost" aria-label="Rename version" onClick={() => ask({ title: "Rename version", initial: v.name, submit: "Rename", onSubmit: (n) => renameVersion(v.id, n) })}>
                  <PencilIcon />
                </Button>
                <Button size="icon-xs" variant="ghost" aria-label="Delete version" onClick={() => deleteVersion(v.id)}>
                  <Trash2Icon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
