import type { Block, Document } from "./model"

let counter = 0
const session = Math.random().toString(36).slice(2, 5)

/** Short unique id. Prefix: b = block, s = suggestion, c = comment. */
export function newId(prefix = "b"): string {
  counter += 1
  return `${prefix}${session}${counter.toString(36)}`
}

/** Deterministic JSON with sorted keys, ignoring identity fields. Two blocks with the same key print the same source. */
export function contentKey(value: unknown): string {
  return JSON.stringify(value, (key, v) => {
    if (key === "id" || key === "sid") return undefined
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) out[k] = (v as Record<string, unknown>)[k]
      return out
    }
    return v
  })
}

/**
 * Carry block identity from a previous version of the document to a newly parsed
 * one. Unchanged blocks (by content) keep their old object entirely; changed
 * blocks in the middle keep the id of the old block at the same position if the
 * type matches. This keeps editor diffs minimal and lets selections, comments
 * and AI references survive re-parsing after a code edit.
 */
export function reconcileIds(prev: Block[], next: Block[]): Block[] {
  const pk = prev.map(contentKey)
  const nk = next.map(contentKey)
  const out = next.slice()
  let start = 0
  while (start < prev.length && start < next.length && pk[start] === nk[start]) {
    out[start] = prev[start]
    start++
  }
  let endP = prev.length
  let endN = next.length
  while (endP > start && endN > start && pk[endP - 1] === nk[endN - 1]) {
    out[endN - 1] = prev[endP - 1]
    endP--
    endN--
  }
  // Middle: match identical blocks that moved, then positional same-type matches.
  const used = new Set<number>()
  const byKey = new Map<string, number[]>()
  for (let i = start; i < endP; i++) {
    const list = byKey.get(pk[i]) ?? []
    list.push(i)
    byKey.set(pk[i], list)
  }
  const pending: number[] = []
  for (let j = start; j < endN; j++) {
    const cands = byKey.get(nk[j])
    const hit = cands?.find((i) => !used.has(i))
    if (hit !== undefined) {
      used.add(hit)
      out[j] = prev[hit]
    } else pending.push(j)
  }
  const taken = new Set(out.filter((b, j) => !pending.includes(j)).map((b) => b.id))
  for (const j of pending) {
    const i = start + (j - start)
    const p = i < endP && !used.has(i) ? prev[i] : undefined
    if (p && p.type === next[j].type && !taken.has(p.id)) {
      used.add(i)
      taken.add(p.id)
      out[j] = { ...next[j], id: p.id } as Block
    } else if (taken.has(next[j].id)) {
      out[j] = { ...next[j], id: newId() } as Block
    } else taken.add(next[j].id)
  }
  return out
}

/** Make sure every top-level block has a unique id. */
export function ensureIds(doc: Document): Document {
  const seen = new Set<string>()
  let changed = false
  const blocks = doc.blocks.map((b) => {
    if (!b.id || seen.has(b.id)) {
      changed = true
      const nb = { ...b, id: newId() } as Block
      seen.add(nb.id)
      return nb
    }
    seen.add(b.id)
    return b
  })
  return changed ? { ...doc, blocks } : doc
}
