/**
 * The word2 agent: Claude working on the document through tools.
 *
 * "AI first" here means the model doesn't paste text into a chat — it edits the
 * document structurally. Every block has an id; the model rewrites blocks by id
 * and the SDK turns each rewrite into word-level tracked changes (with the
 * model's reason attached) that the user accepts or rejects one by one. Drafting
 * from scratch streams straight into the pages.
 *
 * This module has no DOM dependencies so it can be driven from Node for testing.
 */
import Anthropic from "@anthropic-ai/sdk"
import {
  addComment,
  contentKey,
  ensureIds,
  insertBlocks,
  listComments,
  listSuggestions,
  parse,
  replaceBlocks,
  replyToComment,
  resolveComment,
  serializeBlock,
  serializeMeta,
  suggestBlocks,
  updateMeta,
  type Block,
  type DocMeta,
  type Document,
} from "@word2/sdk"
import { SYSTEM_PROMPT } from "./prompt"

export type AgentSettings = {
  model: string
  effort: "low" | "medium" | "high" | "xhigh" | "max"
  /** propose edits as tracked suggestions (true) or apply directly */
  suggest: boolean
}

export type AgentHost = {
  getDoc: () => Document
  /** apply a new document; `live` = intermediate streaming state (no checkpoint) */
  setDoc: (doc: Document, info: { live?: boolean; label: string }) => void
  /** selected block ids + text, if any */
  getSelection: () => { blockIds: string[]; text: string } | null
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; id: string; name: string }
  | { type: "tool_progress"; id: string; name: string; chars: number }
  | { type: "text_start" }
  | { type: "tool_done"; id: string; name: string; summary: string; display: string; error?: boolean }
  | { type: "done"; stopReason: string | null; usage?: Anthropic.Beta.BetaUsage }
  | { type: "error"; message: string }

// ------------------------------------------------------------ document → prompt

/** The document as the model sees it: front matter, then each block preceded by `%% <id>`. */
export function documentForModel(doc: Document): string {
  const parts = [serializeMeta(doc.meta)].filter(Boolean)
  for (const b of doc.blocks) parts.push(`%% ${b.id}\n${serializeBlock(b)}`)
  return parts.join("\n\n")
}

function commentsForModel(doc: Document): string {
  const cs = listComments(doc)
  if (!cs.length) return ""
  return (
    "<comments>\n" +
    cs
      .map((c) => `<comment id="${c.id}" block="${c.blockId}" quote="${c.quote.replace(/"/g, "'")}">\n${c.thread.map((m) => `@${m.author || "user"}: ${m.text}`).join("\n")}\n</comment>`)
      .join("\n") +
    "\n</comments>"
  )
}

export function buildUserTurn(doc: Document, request: string, selection: { blockIds: string[]; text: string } | null, docUnchanged: boolean): string {
  const parts: string[] = []
  parts.push(docUnchanged ? "<document unchanged since your last turn />" : `<document>\n${documentForModel(doc)}\n</document>`)
  const comments = commentsForModel(doc)
  if (comments) parts.push(comments)
  if (selection && selection.blockIds.length) {
    parts.push(`<selection blocks="${selection.blockIds.join(",")}">\n${selection.text.slice(0, 4000)}\n</selection>`)
  }
  parts.push(`<request>\n${request}\n</request>`)
  return parts.join("\n\n")
}

// ------------------------------------------------------------ tools

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "write_document",
    description:
      "Replace the ENTIRE document (front matter + body) with new word2 source. Use only to draft a new document from scratch (empty or placeholder document) or when the user explicitly asks to start over or completely rewrite everything. The text streams live into the user's pages as you write it.",
    input_schema: {
      type: "object",
      properties: { source: { type: "string", description: "Complete word2 source, starting with a --- front matter block (title, theme, header/footer...)." } },
      required: ["source"],
    },
  },
  {
    name: "edit_blocks",
    description:
      "Rewrite existing blocks by id. Each edit replaces one block with new word2 source (which may be several blocks, or empty to delete it). The app turns your rewrite into word-level tracked changes the user can accept or reject individually, so rewrite freely but leave text you don't mean to change exactly as it was. Always give a short reason: it is shown next to each change.",
    input_schema: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Block id from the %% marker" },
              source: { type: "string", description: "New word2 source for this block (no %% markers)" },
              reason: { type: "string", description: "Why, in a few words, e.g. 'tightened', 'fixed agreement', 'more formal'" },
            },
            required: ["id", "source"],
          },
        },
      },
      required: ["edits"],
    },
  },
  {
    name: "insert_blocks",
    description:
      "Insert new blocks (paragraphs, headings, tables, ```chart blocks, lists, callouts...) after a block id, or at 'start' / 'end'. Proposed as a tracked insertion.",
    input_schema: {
      type: "object",
      properties: {
        after: { type: "string", description: "Block id to insert after, or 'start' or 'end'" },
        source: { type: "string", description: "word2 source of the new blocks" },
        reason: { type: "string" },
      },
      required: ["after", "source"],
    },
  },
  {
    name: "add_comment",
    description: "Leave a review comment anchored on a quote inside a block (for questions, concerns, or things only the author can decide).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Block id" },
        quote: { type: "string", description: "Exact text inside that block to anchor on (short)" },
        text: { type: "string" },
      },
      required: ["id", "quote", "text"],
    },
  },
  {
    name: "reply_to_comment",
    description: "Reply to an existing comment thread, optionally resolving it (e.g. after you addressed it with an edit).",
    input_schema: {
      type: "object",
      properties: { comment_id: { type: "string" }, text: { type: "string" }, resolve: { type: "boolean" } },
      required: ["comment_id", "text"],
    },
  },
  {
    name: "update_settings",
    description:
      "Change document settings in the front matter: title, subtitle, author, date, page {size: A4|Letter|Legal|A5, orientation, margins {top,right,bottom,left} in mm}, theme (classic|modern|report|academic), styles {bodyFont, headingFont, fontSize (pt), lineHeight, accent, headingColor, textColor}, header, footer (templates: 'left | center | right' with {{page}} {{pages}} {{title}} {{section}}), titlePage, numberedHeadings, citationStyle (author-date|numeric), references (full list of {id, author, title, year, publisher, url}), ai (the standing brief). Applied directly, not as a suggestion. Set a key to null to remove it.",
    input_schema: { type: "object", properties: { patch: { type: "object" } }, required: ["patch"] },
  },
].map((t) => ({ ...t, eager_input_streaming: true })) as Anthropic.Beta.BetaTool[]

const str = (v: unknown) => (typeof v === "string" ? v : null)

function parseBlocks(source: string): Block[] {
  // a leading newline keeps a first-line `---` from being read as front matter
  return parse("\n" + source).doc.blocks
}

/** summary goes back to the model; display (optional) is the short version for the UI */
export type ToolResult = { summary: string; display?: string; error?: boolean; doc?: Document }

/** Apply one tool call to the document. Pure apart from id generation. */
export function applyTool(name: string, input: Record<string, unknown>, doc: Document, settings: Pick<AgentSettings, "suggest">): ToolResult {
  const meta = { author: "claude" }
  switch (name) {
    case "write_document": {
      const source = str(input.source)
      if (!source) return { summary: "source is required", error: true }
      const r = parse(source)
      return { summary: `Wrote the document: ${r.doc.blocks.length} blocks.${r.errors.length ? " Parse warnings: " + r.errors.map((e) => e.message).join("; ") : ""}`, doc: ensureIds(r.doc) }
    }
    case "edit_blocks": {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : null
      if (!edits?.length) return { summary: "edits must be a non-empty array", error: true }
      let next = doc
      const done: string[] = []
      const missing: string[] = []
      for (const e of edits) {
        const id = str(e.id)
        const source = str(e.source)
        if (!id || source === null) continue
        const old = next.blocks.find((b) => b.id === id)
        if (!old) {
          missing.push(id)
          continue
        }
        const fresh = source.trim() ? parseBlocks(source) : []
        if (fresh.length === 1 && contentKey(fresh[0]) === contentKey(old)) continue
        const reason = str(e.reason) ?? undefined
        const replacement = settings.suggest ? suggestBlocks([old], fresh, { ...meta, note: reason }) : fresh
        next = replacement.length ? replaceBlocks(next, [id], replacement) : { ...next, blocks: next.blocks.filter((b) => b.id !== id) }
        done.push(id)
      }
      const ids = next.blocks.filter((b) => !doc.blocks.some((o) => o.id === b.id)).map((b) => b.id)
      const added = listSuggestions(next).length - listSuggestions(doc).length
      return {
        display: settings.suggest ? `${added} suggestion${added === 1 ? "" : "s"} in ${done.length} block${done.length === 1 ? "" : "s"}` : `Edited ${done.length} block${done.length === 1 ? "" : "s"}`,
        summary:
          `${settings.suggest ? "Proposed changes to" : "Edited"} ${done.length} block(s)${done.length ? ": " + done.join(", ") : ""}.` +
          (ids.length ? ` New block ids: ${ids.join(", ")}.` : "") +
          (missing.length ? ` Unknown ids (re-read the document): ${missing.join(", ")}.` : ""),
        error: done.length === 0 && missing.length > 0,
        doc: next,
      }
    }
    case "insert_blocks": {
      const after = str(input.after)
      const source = str(input.source)
      if (!after || !source) return { summary: "after and source are required", error: true }
      const fresh = parseBlocks(source)
      if (!fresh.length) return { summary: "source parsed to no blocks", error: true }
      const blocks = settings.suggest ? suggestBlocks([], fresh, { ...meta, note: str(input.reason) ?? undefined }) : fresh
      const anchor = after === "start" ? null : after === "end" ? (doc.blocks[doc.blocks.length - 1]?.id ?? null) : after
      if (anchor && !doc.blocks.some((b) => b.id === anchor)) return { summary: `Unknown block id ${anchor}`, error: true }
      const next = insertBlocks(doc, anchor, blocks)
      return { summary: `Inserted ${fresh.length} block(s) as ${blocks.map((b) => b.id).join(", ")}.`, display: `${fresh.length} new block${fresh.length === 1 ? "" : "s"}`, doc: next }
    }
    case "add_comment": {
      const id = str(input.id)
      const text = str(input.text)
      if (!id || !text) return { summary: "id and text are required", error: true }
      const r = addComment(doc, id, str(input.quote) ?? undefined, { author: "claude", text })
      if (!r.id) {
        const fallback = addComment(doc, id, undefined, { author: "claude", text })
        if (!fallback.id) return { summary: `Could not anchor a comment in block ${id}`, error: true }
        return { summary: `Quote not found; commented on the whole block (${fallback.id}).`, doc: fallback.doc }
      }
      return { summary: `Comment ${r.id} added.`, doc: r.doc }
    }
    case "reply_to_comment": {
      const cid = str(input.comment_id)
      const text = str(input.text)
      if (!cid || !text) return { summary: "comment_id and text are required", error: true }
      if (!listComments(doc).some((c) => c.id === cid)) return { summary: `Unknown comment ${cid}`, error: true }
      let next = replyToComment(doc, cid, { author: "claude", text })
      if (input.resolve === true) next = resolveComment(next, cid)
      return { summary: input.resolve ? "Replied and resolved." : "Replied.", doc: next }
    }
    case "update_settings": {
      const patch = input.patch
      if (!patch || typeof patch !== "object") return { summary: "patch must be an object", error: true }
      return { summary: `Updated settings: ${Object.keys(patch).join(", ")}.`, doc: updateMeta(doc, patch as Partial<DocMeta>) }
    }
  }
  return { summary: `Unknown tool ${name}`, error: true }
}

// ------------------------------------------------------------ loop

export class Conversation {
  messages: Anthropic.Beta.BetaMessageParam[] = []
  private lastDocKey: string | null = null

  constructor(
    private client: Anthropic,
    private host: AgentHost,
  ) {}

  reset() {
    this.messages = []
    this.lastDocKey = null
  }

  async send(request: string, settings: AgentSettings, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
    const doc = this.host.getDoc()
    const key = contentKey(doc)
    const text = buildUserTurn(doc, request, this.host.getSelection(), key === this.lastDocKey)
    this.messages.push({ role: "user", content: [{ type: "text", text }] })

    for (let step = 0; step < 12; step++) {
      if (signal?.aborted) break
      const stream = this.client.beta.messages.stream(
        {
          model: settings.model,
          max_tokens: 64000,
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: settings.effort },
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools: TOOLS,
          messages: this.messages,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      )

      // live drafting: render write_document as it streams
      const live = new Map<number, string>()
      let lastPaint = 0
      stream.on("streamEvent", (ev) => {
        if (ev.type === "content_block_start" && ev.content_block.type === "text") onEvent({ type: "text_start" })
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          live.set(ev.index, ev.content_block.name)
          onEvent({ type: "tool_start", id: ev.content_block.id, name: ev.content_block.name })
        }
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") onEvent({ type: "text", text: ev.delta.text })
        if (ev.type === "content_block_delta" && ev.delta.type === "thinking_delta") onEvent({ type: "thinking", text: ev.delta.thinking })
      })
      stream.on("inputJson", (_delta, snapshot) => {
        const snap = snapshot as Record<string, unknown> | undefined
        const current = stream.currentMessage?.content.at(-1)
        if (!current || current.type !== "tool_use") return
        const chars = JSON.stringify(snap ?? {}).length
        onEvent({ type: "tool_progress", id: current.id, name: current.name, chars })
        if (current.name === "write_document" && typeof snap?.source === "string") {
          const now = Date.now()
          if (now - lastPaint < 150) return
          lastPaint = now
          const r = parse(snap.source)
          this.host.setDoc(ensureIds(r.doc), { live: true, label: "Drafting" })
        }
      })

      let message: Anthropic.Beta.BetaMessage
      try {
        message = await stream.finalMessage()
      } catch (e) {
        this.messages.pop()
        onEvent({ type: "error", message: describeError(e) })
        return
      }
      this.messages.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] })

      if (message.stop_reason === "refusal") {
        onEvent({ type: "error", message: "Claude declined this request." })
        onEvent({ type: "done", stopReason: message.stop_reason, usage: message.usage })
        return
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
      if (message.stop_reason === "max_tokens" && toolUses.length) {
        // a truncated tool input must not run
        this.messages.push({
          role: "user",
          content: toolUses.map((t) => ({ type: "tool_result" as const, tool_use_id: t.id, content: "Output was cut off at max_tokens; not applied. Use smaller edits.", is_error: true })),
        })
        continue
      }
      if (message.stop_reason !== "tool_use" || !toolUses.length) {
        this.lastDocKey = contentKey(this.host.getDoc())
        onEvent({ type: "done", stopReason: message.stop_reason, usage: message.usage })
        return
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const t of toolUses) {
        const input = (t.input ?? {}) as Record<string, unknown>
        let r: ToolResult
        try {
          r = applyTool(t.name, input, this.host.getDoc(), settings)
        } catch (e) {
          r = { summary: `Failed: ${(e as Error).message}`, error: true }
        }
        if (r.doc) this.host.setDoc(r.doc, { label: toolLabel(t.name, input) })
        onEvent({ type: "tool_done", id: t.id, name: t.name, summary: r.summary, display: r.display ?? r.summary, error: r.error })
        results.push({ type: "tool_result", tool_use_id: t.id, content: r.summary, ...(r.error ? { is_error: true } : {}) })
      }
      this.messages.push({ role: "user", content: results })
    }
    this.lastDocKey = contentKey(this.host.getDoc())
    onEvent({ type: "done", stopReason: "max_steps" })
  }
}

function toolLabel(name: string, input: Record<string, unknown>) {
  if (name === "write_document") return "Claude drafted the document"
  if (name === "edit_blocks") return `Claude proposed edits (${(input.edits as unknown[] | undefined)?.length ?? 0} blocks)`
  if (name === "insert_blocks") return "Claude inserted blocks"
  return `Claude: ${name.replace(/_/g, " ")}`
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check it in Settings."
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key can't use that model."
  if (e instanceof Anthropic.NotFoundError) return "Model not found. Pick another model in Settings."
  if (e instanceof Anthropic.RateLimitError) return "Rate limited. Wait a moment and try again."
  if (e instanceof Anthropic.APIUserAbortError) return "Stopped."
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API (network or CORS)."
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ""}: ${e.message}`
  return (e as Error)?.message ?? String(e)
}
