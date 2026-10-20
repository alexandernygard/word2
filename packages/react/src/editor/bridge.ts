import type { Document } from "@word2/sdk"

export type ReviewTarget = { sid?: string; cid?: string; rect: DOMRect } | null
export type PageLayout = { pages: number; pageOf: Map<string, number> }
export type LayoutMode = "print" | "web"

type Events = { review: ReviewTarget; layout: PageLayout; config: null }

/**
 * Shared state between the React editor component, ProseMirror plugins and node
 * views: the latest document model (for TOC, citations, references), the page
 * layout computed by the pagination plugin, and a few UI events.
 */
export class EditorBridge {
  doc: Document = { meta: {}, blocks: [] }
  mode: LayoutMode = "print"
  layout: PageLayout = { pages: 1, pageOf: new Map() }
  version = 0
  scrollToBlock: (bid: string) => void = () => {}
  private listeners = new Set<() => void>()
  private handlers: Partial<Record<keyof Events, Set<(v: never) => void>>> = {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getVersion = () => this.version

  update(patch: Partial<Pick<EditorBridge, "doc" | "mode" | "layout">>) {
    Object.assign(this, patch)
    this.version++
    for (const l of this.listeners) l()
  }

  on<K extends keyof Events>(evt: K, fn: (v: Events[K]) => void) {
    const set = (this.handlers[evt] ??= new Set()) as Set<(v: Events[K]) => void>
    set.add(fn)
    return () => {
      set.delete(fn)
    }
  }

  emit<K extends keyof Events>(evt: K, v: Events[K]) {
    for (const fn of (this.handlers[evt] ?? []) as Set<(v: Events[K]) => void>) fn(v)
  }
}
