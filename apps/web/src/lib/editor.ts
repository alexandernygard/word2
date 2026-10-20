import type { Editor } from "@tiptap/core"
import type { EditorApi } from "@word2/react"
import { create } from "zustand"

/** The live TipTap editor + word2 editor API, shared by toolbar, outline and panels. */
export const useEditorRef = create<{ editor: Editor | null; api: EditorApi | null }>(() => ({ editor: null, api: null }))

export function scrollToBlock(bid: string, select = false) {
  useEditorRef.getState().api?.scrollToBlock(bid, select)
}

if (typeof window !== "undefined") (window as unknown as { __w2editor: unknown }).__w2editor = useEditorRef
