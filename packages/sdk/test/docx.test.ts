import { describe, expect, it } from "vitest"
import { exportDocx } from "../src/export/docx"
import { parse } from "../src"
import { SAMPLE } from "./fixture"

describe("docx export", () => {
  it("writes tracked changes, comments, footnotes and a native chart", async () => {
    const { doc } = parse(SAMPLE)
    const blob = await exportDocx(doc, { loadImage: async () => null })
    const buf = new Uint8Array(await blob.arrayBuffer())
    expect(buf.length).toBeGreaterThan(5000)
    const JSZip = (await import("jszip")).default
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file("word/document.xml")!.async("string")
    expect(xml).toContain("<w:ins ")
    expect(xml).toContain("<w:del ")
    expect(xml).toContain("w:commentRangeStart")
    expect(xml).toContain("w:footnoteReference")
    expect(Object.keys(zip.files).some((f) => f.includes("charts/chart"))).toBe(true)
  })
})
