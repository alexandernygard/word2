import { getSchema } from "@tiptap/core"
import { describe, expect, it } from "vitest"
import { contentKey, parse } from "@word2/sdk"
import { SAMPLE } from "../../sdk/test/fixture"
import { docFromPM, docToPM } from "../src/editor/convert"
import { createExtensions } from "../src/editor/extensions"
import { EditorBridge } from "../src/editor/bridge"

describe("model ⇄ ProseMirror", () => {
  const schema = getSchema(createExtensions(new EditorBridge()))
  it("every block of the sample fits the schema and round-trips", () => {
    const { doc } = parse(SAMPLE)
    const node = schema.nodeFromJSON(docToPM(doc.blocks))
    node.check()
    const back = docFromPM(node.toJSON())
    // compare block by block for readable failures
    back.forEach((b, i) => expect(JSON.parse(contentKey(b)), `block ${i} (${b.type})`).toEqual(JSON.parse(contentKey(doc.blocks[i]))))
    expect(back.map((b) => b.id)).toEqual(doc.blocks.map((b) => b.id))
  })
})
