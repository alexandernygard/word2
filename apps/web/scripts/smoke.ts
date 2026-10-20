/** Real-API smoke test of the agent loop: `pnpm tsx scripts/smoke.ts "<request>"` (uses ANTHROPIC_API_KEY or an `ant auth login` profile). */
import Anthropic from "@anthropic-ai/sdk"
import { listSuggestions, parse, serialize, type Document } from "@word2/sdk"
import { Conversation } from "../src/ai/agent"
import { WELCOME } from "../src/sample"

let doc: Document = parse(process.argv[3] === "empty" ? "---\ntitle: Untitled\n---\n" : WELCOME).doc
const conv = new Conversation(new Anthropic(), {
  getDoc: () => doc,
  setDoc: (d, info) => {
    if (!info.live) console.log(`  [setDoc] ${info.label}`)
    doc = d
  },
  getSelection: () => null,
})
const request = process.argv[2] ?? "Tighten the Summary section."
console.log(`> ${request}`)
const t0 = Date.now()
await conv.send(request, { model: process.env.MODEL ?? "claude-opus-5-5", effort: "low", suggest: true }, (e) => {
  if (e.type === "text") process.stdout.write(e.text)
  else if (e.type === "tool_start") console.log(`\n  [tool] ${e.name}`)
  else if (e.type === "tool_done") console.log(`  [done] ${e.summary}`)
  else if (e.type === "error") console.log(`  [error] ${e.message}`)
  else if (e.type === "done") console.log(`\n  [stop] ${e.stopReason} in ${((Date.now() - t0) / 1000).toFixed(1)}s, usage ${JSON.stringify(e.usage ?? {})}`)
})
console.log("\n--- suggestions ---")
for (const s of listSuggestions(doc)) console.log(`${s.sid} ${s.kind}: -"${s.deleted.slice(0, 60)}" +"${s.inserted.slice(0, 60)}" (${s.note ?? ""})`)
console.log("\n--- source (first 2500 chars) ---")
console.log(serialize(doc).text.slice(0, 2500))
