import type { Inline } from "@word2/sdk"

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Tiny inline → HTML renderer for non-React surfaces (page footnote areas, headers). */
export function inlineToHTML(content: Inline[]): string {
  return content
    .map((n) => {
      if (n.type === "break") return "<br>"
      if (n.type === "footnote") return ""
      let s = n.type === "text" ? esc(n.text) : esc(`[${n.keys.join("; ")}]`)
      for (const m of n.marks ?? []) {
        if (m.type === "bold") s = `<strong>${s}</strong>`
        else if (m.type === "italic") s = `<em>${s}</em>`
        else if (m.type === "underline") s = `<u>${s}</u>`
        else if (m.type === "strike") s = `<s>${s}</s>`
        else if (m.type === "code") s = `<code>${s}</code>`
        else if (m.type === "link") s = `<a href="${esc(m.href)}">${s}</a>`
        else if (m.type === "deletion") s = `<del class="w2-del">${s}</del>`
        else if (m.type === "insertion") s = `<ins class="w2-ins">${s}</ins>`
      }
      return s
    })
    .join("")
}

export function escapeHTML(s: string) {
  return esc(s)
}
