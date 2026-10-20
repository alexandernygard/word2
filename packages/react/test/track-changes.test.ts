import { getSchema } from "@tiptap/core"
import { history, undo } from "@tiptap/pm/history"
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model"
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state"
import { describe, expect, it } from "vitest"
import { docFromPM } from "../src/editor/convert"
import { EditorBridge } from "../src/editor/bridge"
import { createExtensions } from "../src/editor/extensions"
import { trackChangesKey, trackChangesPlugin } from "../src/editor/track-changes"

const schema = getSchema(createExtensions(new EditorBridge()).filter((e) => e.name !== "w2TrackChanges"))

function make(paras: string[], enabled = true, author = "alex") {
  const doc = schema.nodeFromJSON({ type: "doc", content: paras.map((t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] })) })
  return EditorState.create({ schema, doc, plugins: [history(), trackChangesPlugin({ enabled, author })] })
}

/** text runs of every paragraph: "plain", "+ins", "-del" */
function runs(state: EditorState) {
  const out: string[][] = []
  state.doc.forEach((p) => {
    const r: string[] = []
    p.forEach((n) => {
      const m = n.marks.find((x) => x.type.name === "insertion" || x.type.name === "deletion")
      r.push((m ? (m.type.name === "insertion" ? "+" : "-") : "") + n.text)
    })
    out.push(r)
  })
  return out
}

function sids(state: EditorState) {
  const s = new Set<string>()
  state.doc.descendants((n: PMNode) => {
    for (const m of n.marks) if (m.type.name === "insertion" || m.type.name === "deletion") s.add(m.attrs.sid as string)
  })
  return [...s]
}

const apply = (s: EditorState, fn: (tr: Transaction) => Transaction) => s.apply(fn(s.tr))
const at = (s: EditorState, pos: number, head = pos) => s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos, head)))
const type = (s: EditorState, text: string) => {
  for (const ch of text) s = apply(s, (tr) => tr.insertText(ch))
  return s
}
const backspace = (s: EditorState) => {
  const { from, empty } = s.selection
  return apply(s, (tr) => (empty ? tr.delete(from - 1, from) : tr.deleteSelection()))
}
const forwardDelete = (s: EditorState) => apply(s, (tr) => tr.delete(s.selection.from, s.selection.from + 1))

describe("track changes plugin", () => {
  it("does nothing when off", () => {
    let s = at(make(["Hello"], false), 6)
    s = backspace(type(s, "!"))
    expect(runs(s)).toEqual([["Hello"]])
  })

  it("marks typed text as one insertion", () => {
    let s = at(make(["Hello world"]), 6)
    s = type(s, " big")
    expect(runs(s)).toEqual([["Hello", "+ big", " world"]])
    expect(sids(s)).toHaveLength(1)
    expect(s.selection.from).toBe(10)
    const ins = docFromPM(s.doc.toJSON())[0]
    expect(ins.type === "paragraph" && ins.content[1].marks?.[0]).toMatchObject({ type: "insertion", author: "alex" })
  })

  it("Backspace strikes text and walks the cursor left, one sid", () => {
    let s = at(make(["Hello world"]), 12)
    s = backspace(backspace(s))
    expect(runs(s)).toEqual([["Hello wor", "-ld"]])
    expect(s.selection.from).toBe(10)
    expect(sids(s)).toHaveLength(1)
  })

  it("Delete strikes text and moves the cursor right", () => {
    let s = at(make(["Hello world"]), 1)
    s = forwardDelete(forwardDelete(s))
    expect(runs(s)).toEqual([["-He", "llo world"]])
    expect(s.selection.from).toBe(3)
    expect(sids(s)).toHaveLength(1)
  })

  it("Backspace over already deleted text only moves the cursor", () => {
    let s = at(make(["Hello"]), 6)
    s = backspace(s)
    const before = s.doc
    s = at(s, 6)
    s = backspace(s)
    expect(s.doc.eq(before)).toBe(true)
    expect(s.selection.from).toBe(5)
  })

  it("replacing a selection becomes deletion + insertion sharing a sid", () => {
    let s = at(make(["Hello world"]), 7, 12)
    s = type(s, "there")
    expect(runs(s)).toEqual([["Hello ", "-world", "+there"]])
    expect(sids(s)).toHaveLength(1)
    expect(s.selection.from).toBe(17)
  })

  it("deleting your own pending insertion really removes it", () => {
    let s = at(make(["Hello"]), 6)
    s = type(s, "!!")
    s = backspace(backspace(s))
    expect(runs(s)).toEqual([["Hello"]])
  })

  it("Backspace across a mark boundary drops inserted text and strikes plain text", () => {
    let s = at(make(["abef"]), 3)
    s = type(s, "cd") // ab+cd ef
    s = at(s, 2, 5) // "b" + "cd"
    s = backspace(s)
    expect(runs(s)).toEqual([["a", "-b", "ef"]])
  })

  it("typing after striking a word groups both into one replacement", () => {
    let s = at(make(["one two"]), 8)
    for (let k = 0; k < 3; k++) s = backspace(s)
    s = type(s, "2")
    expect(runs(s)).toEqual([["one ", "-two", "+2"]])
    expect(s.selection.from).toBe(9)
    expect(sids(s)).toHaveLength(1)
  })

  it("pasting several paragraphs marks all pasted text", () => {
    let s = at(make(["AB"]), 2)
    const slice = new Slice(Fragment.from([schema.node("paragraph", null, schema.text("x")), schema.node("paragraph", null, schema.text("y"))]), 1, 1)
    s = apply(s, (tr) => tr.replaceSelection(slice))
    expect(runs(s)).toEqual([["A", "+x"], ["+y", "B"]])
  })

  it("strips review marks from pasted content", () => {
    let s = at(make(["AB"]), 2)
    const del = schema.marks.deletion.create({ sid: "other", author: "claude" })
    s = apply(s, (tr) => tr.replaceSelection(new Slice(Fragment.from(schema.text("z", [del])), 0, 0)))
    expect(runs(s)).toEqual([["A", "+z", "B"]])
  })

  it("leaves structure edits (Enter, joining paragraphs) untracked", () => {
    let s = at(make(["AB"]), 2)
    s = apply(s, (tr) => tr.split(2))
    expect(runs(s)).toEqual([["A"], ["B"]])
    s = apply(s, (tr) => tr.delete(2, 4)) // join back
    expect(runs(s)).toEqual([["AB"]])
  })

  it("a deletion across paragraphs strikes text but keeps the paragraphs", () => {
    let s = at(make(["Hello", "world"]), 4, 11)
    s = backspace(s)
    expect(runs(s)).toEqual([["Hel", "-lo"], ["-wor", "ld"]])
    expect(sids(s)).toHaveLength(1)
  })

  it("does not merge with another author's suggestion", () => {
    let s = at(make(["Hello"]), 6)
    s = type(s, "!")
    s = s.apply(s.tr.setMeta(trackChangesKey, { author: "sam" }))
    s = type(s, "?")
    expect(sids(s)).toHaveLength(2)
  })

  it("one undo reverts the whole tracked edit", () => {
    let s = at(make(["Hello"]), 6)
    s = backspace(s)
    let undone = s
    undo(s, (tr) => (undone = s.apply(tr)))
    expect(runs(undone)).toEqual([["Hello"]])
  })

  it("IME: composing text is left unmarked and pending; replacing it later does not strike it", () => {
    let s = at(make(["Hi"]), 3)
    s = apply(s, (tr) => tr.insertText("ka").setMeta("composition", 1))
    expect(runs(s)).toEqual([["Hika"]])
    expect(trackChangesKey.getState(s)!.pending).toEqual([{ from: 3, to: 5 }])
    s = apply(s, (tr) => tr.insertText("か", 3, 5).setMeta("composition", 1))
    expect(trackChangesKey.getState(s)!.pending).toEqual([{ from: 3, to: 4 }])
    // the final DOM read may come without the composition meta
    s = apply(s, (tr) => tr.insertText("書", 3, 4))
    expect(runs(s)).toEqual([["Hi", "+書"]])
    expect(trackChangesKey.getState(s)!.pending).toEqual([])
  })

  it("ignores sync transactions from the code view / AI", () => {
    let s = at(make(["Hello"]), 6)
    s = apply(s, (tr) => tr.insertText("!").setMeta("w2-sync", true))
    expect(runs(s)).toEqual([["Hello!"]])
  })
})
