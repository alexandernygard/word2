/**
 * Version history: named snapshots of the document source.
 *  - automatic every few minutes when the source changed since the last version,
 *  - automatic before every Claude turn (when `busy` turns on),
 *  - manual "Save version".
 * Kept in localStorage next to the source.
 */
import { newId } from "@word2/sdk"
import { create } from "zustand"
import { useStore } from "../store"

export type VersionKind = "manual" | "auto" | "claude" | "restore"
export type Version = { id: string; name: string; source: string; at: number; kind: VersionKind }

const LS_VERSIONS = "word2.versions"
const AUTO_INTERVAL = 5 * 60_000
const MAX_AUTO = 20
const MAX_ALL = 60

function load(): Version[] {
  try {
    const v = localStorage.getItem(LS_VERSIONS)
    return v ? (JSON.parse(v) as Version[]) : []
  } catch {
    return []
  }
}

/** newest first */
export const useVersions = create<{ versions: Version[] }>(() => ({ versions: load() }))

function persist(versions: Version[]) {
  try {
    localStorage.setItem(LS_VERSIONS, JSON.stringify(versions))
  } catch {
    /* quota / private mode */
  }
}

/** Snapshot the current source. Skips automatic snapshots when nothing changed since the last version. */
export function saveVersion(name: string, kind: VersionKind = "manual", source = useStore.getState().source): Version | null {
  const prev = useVersions.getState().versions
  if (kind !== "manual" && prev[0]?.source === source) return null
  const v: Version = { id: newId("v"), name, source, at: Date.now(), kind }
  let next = [v, ...prev]
  // prune: keep the newest automatic ones, never drop manual ones unless over the hard cap
  let autos = 0
  next = next.filter((x) => x.kind === "manual" || ++autos <= MAX_AUTO).slice(0, MAX_ALL)
  useVersions.setState({ versions: next })
  persist(next)
  return v
}

export function renameVersion(id: string, name: string) {
  const next = useVersions.getState().versions.map((v) => (v.id === id ? { ...v, name } : v))
  useVersions.setState({ versions: next })
  persist(next)
}

export function deleteVersion(id: string) {
  const next = useVersions.getState().versions.filter((v) => v.id !== id)
  useVersions.setState({ versions: next })
  persist(next)
}

/** Replace the document with a version. The current state is saved first, so a restore can be undone. */
export function restoreVersion(id: string) {
  const v = useVersions.getState().versions.find((x) => x.id === id)
  if (!v) return
  saveVersion(`Before restoring “${v.name}”`, "restore")
  useStore.getState().setSource(v.source, "ui")
}

if (typeof window !== "undefined") {
  // before every Claude turn
  useStore.subscribe((s, p) => {
    if (s.busy && !p.busy) {
      const req = [...s.chat].reverse().find((c) => c.role === "user")
      saveVersion(`Before Claude: ${req?.text.slice(0, 48) ?? "turn"}`, "claude", s.source)
    }
  })
  // on a timer, when there's something new
  setInterval(() => saveVersion("Autosave", "auto"), AUTO_INTERVAL)
}
