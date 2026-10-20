/**
 * Track changes for the human author (Word's "Track changes").
 *
 * When tracking is on, every user transaction is rewritten in `appendTransaction`:
 * the original steps are inverted and replayed as tracked edits —
 *  - inserted text gets an `insertion` mark,
 *  - deleted text stays in the document with a `deletion` mark,
 *  - deleting text that is still a pending insertion really removes it,
 *  - deleting text that is already struck through only moves the cursor past it.
 * Only text is tracked. Pure structure edits (Enter, joining paragraphs, deleting an
 * image, wrapping in a list) go through as they are.
 *
 * Consecutive edits by the same author share a sid: a new edit reuses the sid of an
 * adjacent insertion/deletion by that author, so typing a word, or backspacing over one
 * and typing its replacement, is one suggestion in the Review panel.
 *
 * IME: text typed during a composition is left alone (marking it would rewrite the DOM
 * under the IME) and remembered as `pending`; once the composition ends it gets its
 * insertion mark in one transaction.
 */
import { Extension } from "@tiptap/core"
import { Fragment, Slice, type MarkType, type Node as PMNode } from "@tiptap/pm/model"
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state"
import { Mapping, ReplaceStep } from "@tiptap/pm/transform"
import type { EditorView } from "@tiptap/pm/view"
import { newId } from "@word2/sdk"

type Range = { from: number; to: number }
export type TrackChangesState = { enabled: boolean; author: string; pending: Range[] }

export const trackChangesKey = new PluginKey<TrackChangesState>("w2-track")
/** transactions carrying this meta are never tracked */
export const TRACK_SKIP = "w2-track-skip"

/** Turn tracking on/off and set the author (dispatches a no-op transaction). */
export function setTrackChanges(view: Pick<EditorView, "state" | "dispatch"> | null | undefined, opts: { enabled?: boolean; author?: string }) {
  if (!view) return
  const cur = trackChangesKey.getState(view.state)
  if (!cur || ((opts.enabled ?? cur.enabled) === cur.enabled && (opts.author ?? cur.author) === cur.author)) return
  view.dispatch(view.state.tr.setMeta(trackChangesKey, opts).setMeta("addToHistory", false))
}

function overlaps(ranges: Range[], a: number, b: number) {
  return ranges.some((r) => r.from < b && r.to > a)
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.to > r.from).sort((x, y) => x.from - y.from)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to)
    else out.push({ ...r })
  }
  return out
}

function stripMarks(frag: Fragment, types: MarkType[]): Fragment {
  const nodes: PMNode[] = []
  frag.forEach((n) => nodes.push(n.isInline ? n.mark(n.marks.filter((m) => !types.includes(m.type))) : n.copy(stripMarks(n.content, types))))
  return Fragment.from(nodes)
}

function hasInline(frag: Fragment) {
  let found = false
  frag.descendants((n) => {
    if (n.isInline) found = true
    return !found
  })
  return found
}

/** sid of an `author`'s review mark of `type` on node `n`, if any */
function ownSid(n: PMNode | null | undefined, type: MarkType, author: string): string | undefined {
  return n?.marks.find((m) => m.type === type && m.attrs.author === author)?.attrs.sid ?? undefined
}

function isTracked(tr: Transaction) {
  return (
    tr.docChanged &&
    !tr.getMeta("w2-sync") &&
    !tr.getMeta(TRACK_SKIP) &&
    !tr.getMeta("history$") && // undo / redo
    !tr.getMeta("appendedTransaction") &&
    tr.getMeta("addToHistory") !== false &&
    tr.getMeta("composition") == null
  )
}

/**
 * Rewrite one user transaction as tracked edits. Returns the transaction to append to
 * `newState` (which is `tr` applied to `oldState`), or null when nothing needs tracking.
 */
export function trackTransaction(tr: Transaction, oldState: EditorState, newState: EditorState): Transaction | null {
  const ts = trackChangesKey.getState(oldState)
  const ins = newState.schema.marks.insertion
  const del = newState.schema.marks.deletion
  if (!ts?.enabled || !ins || !del) return null
  const author = ts.author

  const out = newState.tr
  for (let i = tr.steps.length - 1; i >= 0; i--) out.step(tr.steps[i].invert(tr.docs[i]))
  const base = out.steps.length // out.doc is now oldState.doc again
  const pendingNow = () => ts.pending.map((r) => ({ from: out.mapping.slice(base).map(r.from, -1), to: out.mapping.slice(base).map(r.to, 1) }))
  let tracked = false
  let cursor: number | null = null

  tr.steps.forEach((step, i) => {
    // positions in tr.docs[i] → positions in out.doc
    const m = new Mapping(tr.mapping.maps.slice(0, i)).invert()
    m.appendMapping(new Mapping(out.mapping.maps.slice(base)))

    if (!(step instanceof ReplaceStep)) {
      const mapped = step.map(m)
      if (mapped) out.maybeStep(mapped)
      return
    }
    const F = m.map(step.from, 1)
    const T = Math.max(F, m.map(step.to, -1))

    // what's in the deleted range
    const pending = pendingNow()
    const segs: { a: number; b: number; kind: "drop" | "keep" | "mark" }[] = []
    if (T > F)
      out.doc.nodesBetween(F, T, (node, pos) => {
        if (!node.isInline) return true
        const a = Math.max(pos, F)
        const b = Math.min(pos + node.nodeSize, T)
        if (a < b) {
          const kind = node.marks.some((x) => x.type === ins) || overlaps(pending, a, b) ? "drop" : node.marks.some((x) => x.type === del) ? "keep" : "mark"
          segs.push({ a, b, kind })
        }
        return false
      })
    const slice = new Slice(stripMarks(step.slice.content, [ins, del]), step.slice.openStart, step.slice.openEnd)
    const insertsText = hasInline(slice.content)

    if (!segs.length && !insertsText) {
      // structure only (Enter, join paragraphs, delete an image): not tracked
      const mapped = step.map(m)
      if (mapped) out.maybeStep(mapped)
      cursor = null
      return
    }
    tracked = true

    // 1. deletion: mark plain text, drop pending insertions, keep existing deletions
    const $F = out.doc.resolve(F)
    const $T = out.doc.resolve(T)
    let sid: string | undefined
    if (segs.some((s) => s.kind === "mark")) {
      sid = ownSid($T.nodeAfter, del, author) ?? ownSid($F.nodeBefore, del, author) ?? newId("s")
    }
    const mark0 = out.steps.length
    for (const s of [...segs].reverse()) {
      if (s.kind === "drop") out.delete(s.a, s.b)
      else if (s.kind === "mark") out.addMark(s.a, s.b, del.create({ sid, author, note: null }))
    }
    let end = out.mapping.slice(mark0).map(T, -1)

    // 2. insertion, after the deleted text
    if (slice.size) {
      // typing right after Backspace: the cursor sits before your struck text; insert after it
      // instead, so the pair reads (and serializes) as one replacement {~~old~>new~~}
      const dsid = !sid && !slice.openStart && !slice.openEnd ? ownSid(out.doc.resolve(end).nodeAfter, del, author) : undefined
      for (let n = out.doc.resolve(end).nodeAfter; dsid && n && ownSid(n, del, author) === dsid; n = out.doc.resolve(end).nodeAfter) end += n.nodeSize
      const $P = out.doc.resolve(end)
      const isid =
        sid ??
        ownSid($P.nodeBefore, ins, author) ??
        ownSid($P.nodeAfter, ins, author) ??
        ownSid($P.nodeBefore, del, author) ??
        ownSid($P.nodeAfter, del, author) ??
        newId("s")
      const before = out.steps.length
      out.replace(end, end, slice)
      const insEnd = out.mapping.slice(before).map(end, 1)
      if (insertsText) out.addMark(end, insEnd, ins.create({ sid: isid, author, note: null }))
      cursor = insEnd
    } else {
      // Backspace leaves the cursor before the struck text, Delete after it
      const sel = oldState.selection
      const backspace = i === 0 && sel.empty && sel.head === step.to && step.to > step.from
      cursor = backspace ? F : end
    }
  })

  if (!tracked) return null
  const sel = newState.selection
  if (cursor != null && sel instanceof TextSelection && sel.empty) {
    out.setSelection(TextSelection.create(out.doc, Math.min(cursor, out.doc.content.size)))
  } else {
    // (Mapping.slice() results can't be appended or inverted: they keep all maps)
    const m = tr.mapping.invert()
    m.appendMapping(new Mapping(out.mapping.maps.slice(base)))
    out.setSelection(sel.map(out.doc, m))
  }
  if (tr.storedMarks) out.setStoredMarks(tr.storedMarks)
  if (tr.scrolledIntoView) out.scrollIntoView()
  // pending IME text that was deleted is gone; don't let it absorb text inserted next to it
  const after = new Mapping(out.mapping.maps.slice(base))
  const pending = ts.pending.map((r) => ({ from: after.map(r.from, 1), to: after.map(r.to, -1) }))
  return out.setMeta(TRACK_SKIP, true).setMeta(trackChangesKey, { pending: mergeRanges(pending) })
}

/** Mark text left over from an IME composition as inserted. */
function flushPending(view: EditorView) {
  const ts = trackChangesKey.getState(view.state)
  const ins = view.state.schema.marks.insertion
  if (!ts?.pending.length || view.composing || !ins) return
  const tr = view.state.tr
  for (const r of ts.pending) {
    const $from = tr.doc.resolve(r.from)
    const sid = ownSid($from.nodeBefore, ins, ts.author) ?? ownSid(tr.doc.resolve(r.to).nodeAfter, ins, ts.author) ?? newId("s")
    tr.removeMark(r.from, r.to, view.state.schema.marks.deletion)
    tr.addMark(r.from, r.to, ins.create({ sid, author: ts.author, note: null }))
  }
  view.dispatch(tr.setMeta(trackChangesKey, { pending: [] }).setMeta(TRACK_SKIP, true))
}

export function trackChangesPlugin(initial: { enabled?: boolean; author?: string } = {}) {
  return new Plugin<TrackChangesState>({
    key: trackChangesKey,
    state: {
      init: () => ({ enabled: initial.enabled ?? false, author: initial.author ?? "you", pending: [] }),
      apply(tr, v) {
        let next = v
        if (tr.docChanged && v.pending.length) {
          next = { ...v, pending: mergeRanges(v.pending.map((r) => ({ from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) }))) }
        }
        if (next.enabled && tr.docChanged && tr.getMeta("composition") != null) {
          const added: Range[] = []
          tr.mapping.maps.forEach((map, i) =>
            map.forEach((_a, _b, s, e) => {
              if (e > s) added.push({ from: tr.mapping.slice(i + 1).map(s, -1), to: tr.mapping.slice(i + 1).map(e, 1) })
            }),
          )
          next = { ...next, pending: mergeRanges([...next.pending, ...added]) }
        }
        const meta = tr.getMeta(trackChangesKey) as Partial<TrackChangesState> | undefined
        if (meta) next = { ...next, ...meta }
        if (!next.enabled && next.pending.length) next = { ...next, pending: [] }
        return next
      },
    },
    appendTransaction(trs, oldState, newState) {
      const changed = trs.filter((t) => t.docChanged)
      if (changed.length !== 1 || !isTracked(changed[0])) return null
      return trackTransaction(changed[0], oldState, newState)
    },
    props: {
      handleDOMEvents: {
        // typing over a selection with an IME: strike the selection first, as a normal tracked edit
        compositionstart(view) {
          if (!view.composing && trackChangesKey.getState(view.state)?.enabled && !view.state.selection.empty) {
            view.dispatch(view.state.tr.deleteSelection())
          }
          return false
        },
      },
    },
    view() {
      let scheduled = false
      return {
        update(view) {
          if (scheduled || view.composing || !trackChangesKey.getState(view.state)?.pending.length) return
          scheduled = true
          setTimeout(() => {
            scheduled = false
            if (!view.isDestroyed) flushPending(view)
          })
        },
      }
    },
  })
}

export const TrackChanges = Extension.create<{ enabled: boolean; author: string }>({
  name: "w2TrackChanges",
  addOptions: () => ({ enabled: false, author: "you" }),
  addProseMirrorPlugins() {
    return [trackChangesPlugin(this.options)]
  },
})
