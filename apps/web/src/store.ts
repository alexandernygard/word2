/**
 * App state and the code ⇄ document round trip.
 *
 * The document model is the source of truth in memory. Three writers:
 *  - code view   → setSource(text):  parse (ids carried over) → doc
 *  - editor      → setBlocks(blocks): doc → serialize (unchanged blocks keep their original text) → source
 *  - AI / UI     → applyDoc(doc):    doc → serialize → source, and a checkpoint for undo
 * `origin` tells each view whether a change came from itself, so it never echoes
 * its own edit back (which is what would move the cursor).
 */
import type { SelectionInfo } from "@word2/react"
import {
  buildSourceCache,
  contentKey,
  parse,
  serialize,
  updateMeta,
  type BlockSource,
  type Block,
  type DocMeta,
  type Document,
  type SourceCache,
} from "@word2/sdk"
import { create } from "zustand"
import { WELCOME } from "./sample"

/** "remote": a collaborator's edit, arriving through the shared document (see lib/collab.ts). */
export type Origin = "init" | "code" | "editor" | "ai" | "ui" | "remote"

/** Opened from Drive (`?file=<id>`): the document lives in the drive's room, not in localStorage. */
const fromDrive = typeof location !== "undefined" && new URLSearchParams(location.search).has("file")
export type ViewMode = "split" | "doc" | "code"

export type ChatItem =
  | { id: string; role: "user"; text: string; context?: string }
  | {
      id: string
      role: "assistant"
      text: string
      thinking: string
      tools: { id: string; name: string; summary?: string; error?: boolean; chars?: number }[]
      error?: string
      done: boolean
      checkpoint?: number
    }

export type Settings = {
  apiKey: string
  model: string
  effort: "low" | "medium" | "high" | "xhigh" | "max"
  suggest: boolean
  /** track your own edits as suggestions (Word's "Track changes") */
  trackChanges: boolean
  /** author name on your tracked changes */
  author: string
}

type Checkpoint = { doc: Document; label: string; at: number }

type State = {
  source: string
  doc: Document
  sources: BlockSource[]
  frontMatter?: { from: number; to: number }
  errors: { message: string; from: number }[]
  cache: SourceCache
  origin: Origin
  version: number

  activeBlockId: string | null
  activeFrom: "code" | "editor" | null
  selection: SelectionInfo | null

  view: ViewMode
  layout: "print" | "web"
  /** 0 = fit page width to the pane */
  zoom: number
  reading: boolean
  leftOpen: boolean
  rightOpen: boolean
  rightTab: "assistant" | "review" | "history"
  page: { current: number; total: number }
  pageOf: Map<string, number>

  settings: Settings
  chat: ChatItem[]
  busy: boolean
  checkpoints: Checkpoint[]

  /** origin "code" = typed in the code view; anything else (file open, sample) also refreshes the code view */
  setSource: (text: string, origin?: Origin) => void
  setBlocks: (blocks: Block[]) => void
  applyDoc: (doc: Document, origin: "ai" | "ui", opts?: { live?: boolean; label?: string }) => void
  updateMeta: (patch: Partial<DocMeta>) => void
  restore: (index: number) => void
  setActive: (id: string | null, from: "code" | "editor") => void
  set: (patch: Partial<State>) => void
  updateSettings: (patch: Partial<Settings>) => void
}

function cacheFor(doc: Document, text: string, sources: BlockSource[], frontMatter?: { from: number; to: number }): SourceCache {
  const blocks = new Map<string, string>()
  doc.blocks.forEach((b, i) => sources[i] && blocks.set(contentKey(b), text.slice(sources[i].from, sources[i].to)))
  return { blocks, meta: frontMatter ? { key: contentKey(doc.meta), text: text.slice(frontMatter.from, frontMatter.to) } : undefined }
}

const LS_SOURCE = "word2.source"
const LS_SETTINGS = "word2.settings"

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function loadSource(): string {
  if (fromDrive) return ""
  try {
    return localStorage.getItem(LS_SOURCE) ?? WELCOME
  } catch {
    return WELCOME
  }
}

const initialSource = loadSource()
const initial = parse(initialSource)

export const useStore = create<State>((set, get) => ({
  source: initialSource,
  doc: initial.doc,
  sources: initial.sources,
  frontMatter: initial.frontMatter,
  errors: initial.errors,
  cache: buildSourceCache(initialSource, initial),
  origin: "init",
  version: 0,

  activeBlockId: null,
  activeFrom: null,
  selection: null,

  view: "split",
  layout: "print",
  zoom: 0,
  reading: false,
  leftOpen: true,
  rightOpen: true,
  rightTab: "assistant",
  page: { current: 1, total: 1 },
  pageOf: new Map(),

  settings: { apiKey: "", model: "claude-opus-5-5", effort: "medium", suggest: true, trackChanges: false, author: "you", ...load<Partial<Settings>>(LS_SETTINGS, {}) },
  chat: [],
  busy: false,
  checkpoints: [],

  setSource: (text, origin = "code") => {
    if (text === get().source) return
    const r = parse(text, get().doc)
    set((s) => ({
      source: text,
      doc: r.doc,
      sources: r.sources,
      frontMatter: r.frontMatter,
      errors: r.errors,
      cache: buildSourceCache(text, r),
      origin,
      version: s.version + 1,
    }))
  },

  setBlocks: (blocks) => {
    const doc = { ...get().doc, blocks }
    const out = serialize(doc, get().cache)
    set((s) => ({
      doc,
      source: out.text,
      sources: out.sources,
      frontMatter: out.frontMatter,
      errors: [],
      cache: cacheFor(doc, out.text, out.sources, out.frontMatter),
      origin: "editor",
      version: s.version + 1,
    }))
  },

  applyDoc: (doc, origin, opts = {}) => {
    const prev = get().doc
    const out = serialize(doc, get().cache)
    const checkpoints = opts.live ? get().checkpoints : [...get().checkpoints, { doc: prev, label: opts.label ?? "Change", at: Date.now() }].slice(-30)
    set((s) => ({
      doc,
      source: out.text,
      sources: out.sources,
      frontMatter: out.frontMatter,
      errors: [],
      cache: cacheFor(doc, out.text, out.sources, out.frontMatter),
      origin,
      version: s.version + 1,
      checkpoints,
    }))
  },

  updateMeta: (patch) => get().applyDoc(updateMeta(get().doc, patch), "ui", { label: "Settings" }),

  restore: (index) => {
    const cp = get().checkpoints[index]
    if (!cp) return
    get().applyDoc(cp.doc, "ui", { label: `Restore: ${cp.label}` })
    set({ checkpoints: get().checkpoints.slice(0, index) })
  },

  setActive: (id, from) => {
    if (get().activeBlockId === id && get().activeFrom === from) return
    set({ activeBlockId: id, activeFrom: from })
  },

  set: (patch) => set(patch),

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(settings))
    } catch {
      /* private mode */
    }
  },
}))

// persist the source (debounced)
let saveTimer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe((s, p) => {
  if (s.source === p.source || fromDrive) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_SOURCE, s.source)
    } catch {
      /* ignore */
    }
  }, 400)
})

/** Minimal text change between two strings (common prefix/suffix). */
export function textChange(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null
  let s = 0
  const max = Math.min(a.length, b.length)
  while (s < max && a.charCodeAt(s) === b.charCodeAt(s)) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a.charCodeAt(a.length - 1 - e) === b.charCodeAt(b.length - 1 - e)) e++
  return { from: s, to: a.length - e, insert: b.slice(s, b.length - e) }
}

/** expose for debugging / browser tests */
if (typeof window !== "undefined") (window as unknown as { __w2: unknown }).__w2 = { useStore }
