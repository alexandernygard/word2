import type Anthropic from "@anthropic-ai/sdk"

type Block = Record<string, unknown>
/** A scripted stand-in for client.beta.messages.stream(): replays canned assistant turns. */
export function fakeClient(turns: { content: Block[]; stop_reason: string }[], seen: unknown[]) {
  let i = 0
  return {
    beta: {
      messages: {
        stream(params: unknown) {
          seen.push(structuredClone(params))
          const turn = turns[i++]
          const handlers: Record<string, ((...a: unknown[]) => void)[]> = {}
          const s = {
            currentMessage: { content: [] as Block[] },
            on(evt: string, fn: (...a: unknown[]) => void) {
              ;(handlers[evt] ??= []).push(fn)
              return s
            },
            async finalMessage() {
              turn.content.forEach((b, index) => {
                handlers.streamEvent?.forEach((f) => f({ type: "content_block_start", index, content_block: b }))
                s.currentMessage.content.push(b)
                if (b.type === "text") handlers.streamEvent?.forEach((f) => f({ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } }))
                if (b.type === "tool_use") {
                  // stream the input in 3 growing snapshots, like eager input streaming
                  const json = JSON.stringify(b.input)
                  for (const k of [0.3, 0.6, 1]) {
                    const part = json.slice(0, Math.floor(json.length * k))
                    let snap: unknown = {}
                    try {
                      snap = JSON.parse(part)
                    } catch {
                      const src = /"source":"((?:[^"\\]|\\.)*)/.exec(part)?.[1]
                      snap = src ? { source: JSON.parse(`"${src.replace(/\\$/, "")}"`) } : {}
                    }
                    handlers.inputJson?.forEach((f) => f(part, snap))
                  }
                }
              })
              return { content: turn.content, stop_reason: turn.stop_reason, usage: {} }
            },
          }
          return s
        },
      },
    },
  } as unknown as Anthropic
}

