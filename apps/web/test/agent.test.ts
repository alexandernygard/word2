import type Anthropic from "@anthropic-ai/sdk"
import { listComments, listSuggestions, parse, serialize, type Document } from "@word2/sdk"
import { describe, expect, it } from "vitest"
import { Conversation, applyTool, documentForModel } from "../src/ai/agent"
import { WELCOME } from "../src/sample"

import { fakeClient } from "./fakeClient"

describe("agent", () => {
  it("shows the model every block with its id", () => {
    const doc = parse(WELCOME).doc
    const text = documentForModel(doc)
    expect(text).toContain(`%% ${doc.blocks[1].id}\n# Summary`)
  })

  it("turns a block rewrite into reviewable suggestions and finishes the loop", async () => {
    let doc: Document = parse(WELCOME).doc
    const para = doc.blocks.find((b) => b.type === "paragraph" && JSON.stringify(b).includes("strongest quarter"))!
    const seen: unknown[] = []
    const client = fakeClient(
      [
        {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "edit_blocks",
              input: {
                edits: [
                  {
                    id: para.id,
                    source:
                      "Q3 was Northwind's best quarter yet. Revenue reached **€4.8m**, up 18%, and subscriptions grew fastest.^[All figures are unaudited management accounts.] Wholesale held steady; café revenue dipped as office occupancy plateaued.",
                    reason: "tightened",
                  },
                ],
              },
            },
            { type: "tool_use", id: "t2", name: "add_comment", input: { id: para.id, quote: "best quarter", text: "Worth citing last year's peak?" } },
          ],
        },
        { stop_reason: "end_turn", content: [{ type: "text", text: "Tightened the opening paragraph." }] },
      ],
      seen,
    )
    const events: string[] = []
    const conv = new Conversation(client, { getDoc: () => doc, setDoc: (d) => (doc = d), getSelection: () => null })
    await conv.send("Tighten the summary", { model: "claude-opus-5-5", effort: "low", suggest: true }, (e) => events.push(e.type))

    const sugg = listSuggestions(doc)
    expect(sugg.length).toBeGreaterThan(2)
    expect(sugg.every((s) => s.author === "claude")).toBe(true)
    expect(sugg.find((s) => s.note === "tightened")).toBeTruthy()
    expect(listComments(doc).some((c) => c.thread[0].text.includes("last year"))).toBe(true)
    // unchanged words stay unmarked; the footnote and bold survive
    const src = serialize(doc).text
    expect(src).toContain("**€4.8m**")
    expect(src).toContain("^[All figures are unaudited management accounts.]")
    // second request carried the tool results back
    expect(seen.length).toBe(2)
    const second = seen[1] as { messages: { role: string; content: { type: string; content?: string }[] }[] }
    const results = second.messages[2].content
    expect(results.map((r) => r.type)).toEqual(["tool_result", "tool_result"])
    expect(events.at(-1)).toBe("done")
  })

  it("streams write_document into the document while drafting", async () => {
    let doc: Document = parse("---\ntitle: Untitled\n---\n").doc
    const live: number[] = []
    const source = "---\ntitle: Solar co-op proposal\ntheme: modern\n---\n\n# Problem\n\nRoofs sit empty.\n\n# Plan\n\n- Lease roofs\n- Sell power\n"
    const client = fakeClient(
      [
        { stop_reason: "tool_use", content: [{ type: "tool_use", id: "w", name: "write_document", input: { source } }] },
        { stop_reason: "end_turn", content: [{ type: "text", text: "Drafted." }] },
      ],
      [],
    )
    const conv = new Conversation(client, {
      getDoc: () => doc,
      setDoc: (d, info) => {
        if (info.live) live.push(d.blocks.length)
        doc = d
      },
      getSelection: () => null,
    })
    await conv.send("Draft a proposal", { model: "claude-opus-5-5", effort: "low", suggest: true }, () => {})
    expect(live.length).toBeGreaterThan(0)
    expect(doc.meta.title).toBe("Solar co-op proposal")
    expect(doc.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "heading", "list"])
  })

  it("rejects unknown ids with an error the model can recover from", () => {
    const doc = parse(WELCOME).doc
    const r = applyTool("edit_blocks", { edits: [{ id: "nope", source: "x" }] }, doc, { suggest: true })
    expect(r.error).toBe(true)
    expect(r.summary).toContain("Unknown ids")
  })
})
