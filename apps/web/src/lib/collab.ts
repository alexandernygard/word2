/**
 * Live collaboration for a document from Drive (drive.nyggis.com), opened as `?file=<id>`.
 *
 * The Y.Doc holds the document source as one text ("source"); bindText keeps it equal to the store's
 * source, and edits from others arrive through setSource(…, "remote"), which every view treats as an
 * outside change. Access follows the file's sharing in Drive: the room ticket says who you are and
 * whether you may write. Each surface keeps its own undo history; remote edits never go on it.
 */
import { CollabProvider, ORIGIN_AI, ORIGIN_LOCAL, bindText, colorFor, getPeers, setPresence, throttle, type Peer } from "@alexandernygard/collab"
import { DriveError, deniedMessage, fileFromUrl, getDrive, template, type Item, type Me } from "@alexandernygard/drive"
import { create } from "zustand"
import { useStore } from "../store"

export const drive = getDrive()

/** The Drive file this tab was opened for, if any. Fixed for the page's life. */
export const driveFileId = fileFromUrl()

export interface DocPresence {
  /** The block this person's caret is in. */
  block?: string | null
}

interface CollabState {
  status: "off" | "connecting" | "live" | "offline" | "failed"
  failure: string | null
  needsSignIn: boolean
  readOnly: boolean
  item: Item | null
  peers: Peer<DocPresence>[]
}

export const useCollab = create<CollabState>(() => ({ status: "off", failure: null, needsSignIn: false, readOnly: false, item: null, peers: [] }))

let account: Me | null = null
const me = () =>
  account
    ? { name: account.name || account.email, color: colorFor(account.id), id: account.id, picture: account.picture, email: account.email }
    : { name: "Someone", color: colorFor("anon") }

export function startCollab(id: string): () => void {
  let provider!: CollabProvider
  provider = new CollabProvider(
    drive.roomOptions(
      id,
      (t) => {
        useCollab.setState({ item: t.item, readOnly: t.readOnly, needsSignIn: false, failure: null })
        document.title = `${t.item.name} – word2`
      },
      (e: DriveError) => {
        useCollab.setState({ failure: deniedMessage(e), needsSignIn: e.status === 401, status: "failed" })
        setTimeout(() => provider.disconnect())
      },
    ),
  )
  const text = provider.doc.getText("source")
  const cleanups: (() => void)[] = []
  let unbind: (() => void) | null = null

  const bind = () => {
    // Called once, after the first sync, so nothing is pushed on top of content we have not received yet.
    if (text.length === 0 && !useCollab.getState().readOnly) {
      // The drive seeds new documents; this covers one it couldn't.
      provider.doc.transact(() => text.insert(0, template("doc", useCollab.getState().item?.name ?? "Untitled document").text!), "seed")
    }
    unbind = bindText(text, {
      get: () => useStore.getState().source,
      set: (next) => useStore.getState().setSource(next, "remote"),
      subscribe: (fn) =>
        useStore.subscribe((s, prev) => {
          if (s.source === prev.source || s.origin === "remote") return
          fn(s.source, s.origin === "ai" ? ORIGIN_AI : ORIGIN_LOCAL)
        }),
    })
  }

  const status = () => {
    const s = provider.status
    if (useCollab.getState().failure) return
    useCollab.setState({ status: s === "connected" ? (provider.synced ? "live" : "connecting") : s === "failed" ? "failed" : s === "connecting" ? "connecting" : "offline" })
  }
  cleanups.push(
    provider.on("status", status),
    provider.on("synced", (synced) => {
      status()
      if (synced && !unbind) bind()
    }),
    provider.on("fatal", (code, reason) => useCollab.setState({ failure: code === 4426 ? "This version of word2 is out of date. Refresh the page." : reason || "Could not open the document." })),
  )

  const peers = () => useCollab.setState({ peers: getPeers<DocPresence>(provider.awareness) })
  provider.awareness.on("change", peers)
  cleanups.push(() => provider.awareness.off("change", peers))

  const publish = throttle(() => setPresence<DocPresence>(provider.awareness, { user: me(), block: useStore.getState().activeBlockId }), 80)
  cleanups.push(useStore.subscribe((s, prev) => s.activeBlockId !== prev.activeBlockId && publish()))
  void drive.me().then(
    (m) => {
      account = m
      publish()
    },
    () => {},
  )

  useCollab.setState({ status: "connecting" })
  return () => {
    unbind?.()
    for (const c of cleanups) c()
    provider.destroy()
    useCollab.setState({ status: "off", peers: [], item: null })
  }
}

/** Put the open document in Drive and reopen it from there. The local copy stays as it was. */
export async function saveToDrive(): Promise<void> {
  const { source, doc } = useStore.getState()
  const item = await drive.create({ kind: "doc", name: doc.meta.title || "Untitled document", content: { text: source } })
  location.href = drive.appUrl("doc", item.id)
}

/** A new document in Drive, opened in this tab. */
export async function newDriveDocument(): Promise<void> {
  const item = await drive.create({ kind: "doc", name: "Untitled document" })
  location.href = drive.appUrl("doc", item.id)
}
