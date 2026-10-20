import { Button, Input, Textarea } from "@alexandernygard/components"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import {
  bibliography,
  citedKeys,
  formatCitation,
  formatReference,
  outline,
  parseChart,
  parseInline,
  resolveTheme,
  serializeChart,
  serializeInline,
  type ChartSpec,
  type Inline,
} from "@word2/sdk"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { DocChart } from "../shared/DocChart"
import type { EditorBridge } from "./bridge"

function useBridge(props: NodeViewProps): EditorBridge {
  const bridge = (props.editor.storage as unknown as Record<string, { bridge: EditorBridge }>).w2Interaction.bridge
  useSyncExternalStore(bridge.subscribe, bridge.getVersion)
  return bridge
}

export function TocView(props: NodeViewProps) {
  const bridge = useBridge(props)
  const depth = (props.node.attrs.depth as number | null) ?? 3
  const items = outline(bridge.doc).filter((o) => o.level <= depth)
  const numbered = !!bridge.doc.meta.numberedHeadings
  return (
    <NodeViewWrapper as="nav" className="w2-toc" data-selected={props.selected || undefined} contentEditable={false}>
      <div className="w2-toc-title">{(props.node.attrs.title as string) || "Contents"}</div>
      {items.length === 0 && <div className="w2-toc-empty">Headings will appear here.</div>}
      {items.map((o) => (
        <a
          key={o.id}
          className="w2-toc-item"
          data-level={o.level}
          href={`#${o.id}`}
          onClick={(e) => {
            e.preventDefault()
            bridge.scrollToBlock(o.id)
          }}
        >
          <span className="w2-toc-text">
            {numbered && <span className="w2-toc-num">{o.number}</span>}
            {o.text}
          </span>
          {bridge.mode === "print" && <span className="w2-toc-page">{bridge.layout.pageOf.get(o.id) ?? ""}</span>}
        </a>
      ))}
    </NodeViewWrapper>
  )
}

export function ReferencesView(props: NodeViewProps) {
  const bridge = useBridge(props)
  const refs = bibliography(bridge.doc)
  const numeric = bridge.doc.meta.citationStyle === "numeric"
  return (
    <NodeViewWrapper as="section" className="w2-references" contentEditable={false}>
      <h2 className="w2-references-title">{(props.node.attrs.title as string) || "References"}</h2>
      {refs.length === 0 && <p className="w2-toc-empty">Cite sources with [@key]; define them under `references:` in the front matter.</p>}
      <ol className={numeric ? "w2-refs-numeric" : "w2-refs"}>
        {refs.map((r) => (
          <li key={r.id}>{formatReference(r)}</li>
        ))}
      </ol>
    </NodeViewWrapper>
  )
}

export function CiteView(props: NodeViewProps) {
  const bridge = useBridge(props)
  const keys = props.node.attrs.keys as string[]
  const locator = (props.node.attrs.locator as string | null) ?? undefined
  const text = formatCitation({ type: "cite", keys, locator }, bridge.doc.meta, citedKeys(bridge.doc))
  return (
    <NodeViewWrapper as="span" className="w2-cite" data-selected={props.selected || undefined} title={keys.join(", ")}>
      {text}
    </NodeViewWrapper>
  )
}

export function FootnoteView(props: NodeViewProps) {
  const content = props.node.attrs.content as Inline[]
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])
  const save = () => {
    props.updateAttributes({ content: parseInline(draft) })
    setEditing(false)
  }
  return (
    <NodeViewWrapper as="span" className="w2-fn-wrap">
      <sup
        className="w2-fn-ref"
        data-selected={props.selected || undefined}
        title={content.map((n) => (n.type === "text" ? n.text : "")).join("")}
        onClick={() => {
          setDraft(serializeInline(content))
          setEditing(true)
        }}
      />
      {editing && (
        <span className="w2-popover" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          <Textarea
            ref={ref}
            value={draft}
            rows={3}
            placeholder="Footnote text (markdown)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                save()
              }
              if (e.key === "Escape") setEditing(false)
            }}
            onBlur={save}
          />
        </span>
      )}
    </NodeViewWrapper>
  )
}

export function ChartView(props: NodeViewProps) {
  const bridge = useBridge(props)
  const spec = props.node.attrs.spec as ChartSpec
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const accent = resolveTheme(bridge.doc.meta).accent
  const open = () => {
    setDraft(serializeChart({ id: "", type: "chart", ...spec }).replace(/^```chart\n|\n```$/g, ""))
    setEditing(true)
  }
  const apply = () => {
    const { id: _i, type: _t, ...next } = parseChart(draft, "")
    props.updateAttributes({ spec: next })
    setEditing(false)
  }
  return (
    <NodeViewWrapper className="w2-chart-node" data-selected={props.selected || undefined} contentEditable={false} data-drag-handle>
      <div onDoubleClick={open}>
        <DocChart spec={spec} accent={accent} />
      </div>
      {props.selected && !editing && (
        <div className="w2-node-toolbar">
          <Button size="xs" variant="outline" onClick={open}>
            Edit data
          </Button>
          {(["bar", "line", "area", "pie"] as const).map((t) => (
            <Button key={t} size="xs" variant={spec.chart === t ? "default" : "ghost"} onClick={() => props.updateAttributes({ spec: { ...spec, chart: t } })}>
              {t}
            </Button>
          ))}
        </div>
      )}
      {editing && (
        <div className="w2-chart-editor" onMouseDown={(e) => e.stopPropagation()}>
          <Textarea className="font-mono text-xs" rows={Math.min(14, draft.split("\n").length + 1)} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <Button size="xs" onClick={apply}>
              Apply
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  )
}

export function ImageView(props: NodeViewProps) {
  const { src, alt, caption, width } = props.node.attrs as { src: string; alt?: string; caption?: string; width?: string }
  return (
    <NodeViewWrapper as="figure" className="w2-figure" data-selected={props.selected || undefined} contentEditable={false} data-drag-handle>
      {src ? <img src={src} alt={alt ?? ""} style={{ width: width ?? "100%" }} draggable={false} /> : <div className="w2-image-empty">No image source</div>}
      {caption && <figcaption className="w2-caption">{caption}</figcaption>}
      {props.selected && (
        <div className="w2-node-toolbar" onMouseDown={(e) => e.stopPropagation()}>
          {["25%", "50%", "75%", "100%"].map((w) => (
            <Button key={w} size="xs" variant={(width ?? "100%") === w ? "default" : "ghost"} onClick={() => props.updateAttributes({ width: w === "100%" ? null : w })}>
              {w}
            </Button>
          ))}
          <Input
            className="h-7 w-56 text-xs"
            placeholder="Caption"
            defaultValue={caption ?? ""}
            onBlur={(e) => props.updateAttributes({ caption: e.target.value || null })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
      )}
    </NodeViewWrapper>
  )
}
