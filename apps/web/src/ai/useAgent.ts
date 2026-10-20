import Anthropic from "@anthropic-ai/sdk"
import { useStore, type ChatItem } from "../store"
import { Conversation, type AgentSettings } from "./agent"

let conversation: Conversation | null = null
let clientKey = ""
let controller: AbortController | null = null

let injected: Anthropic | null = null
/** Test seam: drive the UI with a scripted client instead of the real API. */
export function __useClientForTesting(client: Anthropic | null) {
  injected = client
  conversation = null
}

function getConversation(apiKey: string) {
  if (!conversation || clientKey !== apiKey) {
    const client = injected ?? new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    conversation = new Conversation(client, {
      getDoc: () => useStore.getState().doc,
      setDoc: (doc, info) => useStore.getState().applyDoc(doc, "ai", { live: true, label: info.label }),
      getSelection: () => {
        const s = useStore.getState().selection
        return s && !s.empty ? { blockIds: s.blockIds, text: s.text } : null
      },
    })
    clientKey = apiKey
  }
  return conversation
}

export function resetConversation() {
  conversation?.reset()
  useStore.setState({ chat: [] })
}

export function stopAgent() {
  controller?.abort()
}

let n = 0
const uid = () => `m${Date.now().toString(36)}${n++}`

/** Send a request to Claude. `display` is what the chat shows (quick actions show a short label). */
export async function askClaude(request: string, opts: { display?: string; effort?: AgentSettings["effort"] } = {}) {
  const store = useStore.getState()
  if (store.busy) return
  const { apiKey, model, effort, suggest } = store.settings
  if (!apiKey && !injected) {
    useStore.setState({ rightOpen: true, rightTab: "assistant" })
    window.dispatchEvent(new CustomEvent("w2:need-key"))
    return
  }
  const sel = store.selection
  const context = sel && !sel.empty ? `${sel.blockIds.length} block${sel.blockIds.length === 1 ? "" : "s"} selected` : undefined
  // checkpoint: the document as it was before this turn
  useStore.setState((s) => ({ checkpoints: [...s.checkpoints, { doc: s.doc, label: opts.display ?? request.slice(0, 40), at: Date.now() }].slice(-30) }))
  const checkpoint = useStore.getState().checkpoints.length - 1
  const user: ChatItem = { id: uid(), role: "user", text: opts.display ?? request, context }
  const asst: ChatItem = { id: uid(), role: "assistant", text: "", thinking: "", tools: [], done: false, checkpoint }
  useStore.setState((s) => ({ chat: [...s.chat, user, asst], busy: true, rightOpen: true, rightTab: "assistant" }))

  const patch = (fn: (m: Extract<ChatItem, { role: "assistant" }>) => Extract<ChatItem, { role: "assistant" }>) =>
    useStore.setState((s) => ({ chat: s.chat.map((m) => (m.id === asst.id && m.role === "assistant" ? fn(m) : m)) }))

  controller = new AbortController()
  try {
    await getConversation(apiKey).send(
      request,
      { model, effort: opts.effort ?? effort, suggest },
      (e) => {
        if (e.type === "text_start") patch((m) => (m.text && !m.text.endsWith("\n") ? { ...m, text: m.text + "\n\n" } : m))
        else if (e.type === "text") patch((m) => ({ ...m, text: m.text + e.text }))
        else if (e.type === "thinking") patch((m) => ({ ...m, thinking: m.thinking + e.text }))
        else if (e.type === "tool_start") patch((m) => ({ ...m, tools: [...m.tools, { id: e.id, name: e.name }] }))
        else if (e.type === "tool_progress") patch((m) => ({ ...m, tools: m.tools.map((t) => (t.id === e.id ? { ...t, chars: e.chars } : t)) }))
        else if (e.type === "tool_done") patch((m) => ({ ...m, tools: m.tools.map((t) => (t.id === e.id ? { ...t, summary: e.display, error: e.error } : t)) }))
        else if (e.type === "error") patch((m) => ({ ...m, error: e.message }))
      },
      controller.signal,
    )
  } finally {
    patch((m) => ({ ...m, done: true }))
    useStore.setState({ busy: false })
    controller = null
  }
}

export const QUICK_ACTIONS = {
  improve: { label: "Improve writing", prompt: "Improve the writing of the selected text: clearer, more concrete, better flow. Keep the meaning and the facts." },
  tighten: { label: "Tighten", prompt: "Tighten the selected text: cut unnecessary words and repetition, keep all of the meaning." },
  expand: { label: "Expand", prompt: "Expand the selected text with real substance (specifics, examples, reasoning), roughly doubling it. Don't add filler." },
  grammar: { label: "Fix grammar", prompt: "Fix spelling, grammar and punctuation in the selected text. Minimal corrections only; don't restyle." },
  summarize: {
    label: "Summarize",
    prompt: "Summarize the selected text (or the whole document if nothing is selected) in 2-4 sentences and insert it as a :::note[Summary] callout just before it.",
  },
  continue: { label: "Continue writing", prompt: "Continue writing after the selected block (or the end of the document): one or two paragraphs that fit the style and argument." },
  table: { label: "Make a table", prompt: "Turn the selected text or data into a well-structured table with a caption, inserted right after the selection. Keep the original text." },
  chart: {
    label: "Chart from data",
    prompt: "Create a chart from the data in the selected table or text (or the nearest table) and insert it right after it. Pick the chart type that fits the data and give it a title.",
  },
  comments: { label: "Address @claude comments", prompt: "Address every comment addressed to @claude: make the requested edits, then reply to each comment and resolve it." },
  review: {
    label: "Review document",
    prompt: "Review the whole document as a sharp editor: propose specific edits for clarity, structure and consistency as tracked changes, and leave comments for questions only the author can answer. Don't rewrite everything.",
  },
} as const

export const TONES = ["formal", "friendly", "confident", "plain-language", "persuasive"]
