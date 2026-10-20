import {
  bibliography,
  citedKeys,
  formatCitation,
  formatReference,
  outline,
  resolveTheme,
  type Block,
  type DocMeta,
  type Document,
  type FootnoteNode,
  type Inline,
  type Mark,
} from "@word2/sdk"
import { Fragment, type ReactNode } from "react"
import { DocChart } from "../shared/DocChart"

export type RenderContext = {
  doc: Document
  meta: DocMeta
  cited: string[]
  footnoteNo: Map<FootnoteNode, number>
  pageOf?: Map<string, number>
  showPages?: boolean
}

export function createRenderContext(doc: Document, pageOf?: Map<string, number>): RenderContext {
  const footnoteNo = new Map<FootnoteNode, number>()
  let k = 0
  const visitInl = (c: Inline[]) => c.forEach((n) => n.type === "footnote" && footnoteNo.set(n, ++k))
  const visit = (b: Block) => {
    if (b.type === "paragraph" || b.type === "heading") visitInl(b.content)
    else if (b.type === "table") b.rows.forEach((r) => r.cells.forEach((c) => visitInl(c.content)))
    else if (b.type === "list") b.items.forEach((i) => i.blocks.forEach(visit))
    else if ("blocks" in b) b.blocks.forEach(visit)
  }
  doc.blocks.forEach(visit)
  return { doc, meta: doc.meta, cited: citedKeys(doc), footnoteNo, pageOf, showPages: !!pageOf }
}

function wrapMark(m: Mark, child: ReactNode, key: number): ReactNode {
  switch (m.type) {
    case "bold":
      return <strong key={key}>{child}</strong>
    case "italic":
      return <em key={key}>{child}</em>
    case "underline":
      return <u key={key}>{child}</u>
    case "strike":
      return <s key={key}>{child}</s>
    case "code":
      return <code key={key}>{child}</code>
    case "sup":
      return <sup key={key}>{child}</sup>
    case "sub":
      return <sub key={key}>{child}</sub>
    case "smallcaps":
      return <span key={key} className="w2-smallcaps">{child}</span>
    case "highlight":
      return <mark key={key}>{child}</mark>
    case "color":
      return <span key={key} style={{ color: m.color }}>{child}</span>
    case "link":
      return <a key={key} href={m.href} title={m.title}>{child}</a>
    case "insertion":
      return <ins key={key} className="w2-ins" data-sid={m.id} title={m.note}>{child}</ins>
    case "deletion":
      return <del key={key} className="w2-del" data-sid={m.id} title={m.note}>{child}</del>
    case "comment":
      return <span key={key} className="w2-comment" data-cid={m.id} title={m.thread.map((t) => `${t.author}: ${t.text}`).join("\n")}>{child}</span>
  }
}

export function Inlines({ content, ctx }: { content: Inline[]; ctx: RenderContext }) {
  return (
    <>
      {content.map((n, i) => {
        let el: ReactNode
        if (n.type === "text") el = n.text
        else if (n.type === "break") el = <br />
        else if (n.type === "cite") el = <cite className="w2-cite">{formatCitation(n, ctx.meta, ctx.cited)}</cite>
        else el = <sup className="w2-fn-num">{ctx.footnoteNo.get(n) ?? "*"}</sup>
        for (const [k, m] of (n.marks ?? []).slice().reverse().entries()) el = wrapMark(m, el, k)
        return <Fragment key={i}>{el}</Fragment>
      })}
    </>
  )
}

function Blocks({ blocks, ctx }: { blocks: Block[]; ctx: RenderContext }) {
  return (
    <>
      {blocks.map((b) => (
        <BlockView key={b.id} block={b} ctx={ctx} />
      ))}
    </>
  )
}

export function BlockView({ block: b, ctx }: { block: Block; ctx: RenderContext }): ReactNode {
  switch (b.type) {
    case "paragraph":
      return (
        <p data-bid={b.id} style={b.align ? { textAlign: b.align } : undefined}>
          <Inlines content={b.content} ctx={ctx} />
        </p>
      )
    case "heading": {
      const H = `h${b.level}` as "h1"
      return (
        <H data-bid={b.id} id={b.anchor ?? b.id} style={b.align ? { textAlign: b.align } : undefined}>
          <Inlines content={b.content} ctx={ctx} />
        </H>
      )
    }
    case "list": {
      const items = b.items.map((it, i) => (
        <li key={i} data-checked={b.kind === "task" ? String(!!it.checked) : undefined}>
          {b.kind === "task" && <input type="checkbox" checked={!!it.checked} readOnly />}
          <div>
            <Blocks blocks={it.blocks} ctx={ctx} />
          </div>
        </li>
      ))
      if (b.kind === "ordered")
        return (
          <ol data-bid={b.id} start={b.start}>
            {items}
          </ol>
        )
      return (
        <ul data-bid={b.id} data-type={b.kind === "task" ? "taskList" : undefined}>
          {items}
        </ul>
      )
    }
    case "blockquote":
      return (
        <blockquote data-bid={b.id}>
          <Blocks blocks={b.blocks} ctx={ctx} />
        </blockquote>
      )
    case "callout":
      return (
        <div className="w2-callout" data-variant={b.variant} data-bid={b.id}>
          <div className="w2-callout-title">{b.title ?? b.variant}</div>
          <div className="w2-callout-body">
            <Blocks blocks={b.blocks} ctx={ctx} />
          </div>
        </div>
      )
    case "columns":
      return (
        <div className="w2-columns" style={{ columnCount: b.count }} data-bid={b.id}>
          <Blocks blocks={b.blocks} ctx={ctx} />
        </div>
      )
    case "suggestion":
      return (
        <div className="w2-sugblock" data-kind={b.kind} data-sid={b.sid} data-bid={b.id}>
          <div className="w2-sugblock-label">
            {b.kind === "insert" ? "Suggested insertion" : "Suggested deletion"}
            {b.author ? ` · @${b.author}` : ""}
            {b.note ? ` — ${b.note}` : ""}
          </div>
          <div className="w2-sugblock-body">
            <Blocks blocks={b.blocks} ctx={ctx} />
          </div>
        </div>
      )
    case "code":
      return (
        <pre className="w2-code" data-bid={b.id}>
          <code>{b.text}</code>
        </pre>
      )
    case "table":
      return (
        <table className="w2-table" data-bid={b.id}>
          {b.caption && <caption>{b.caption}</caption>}
          <tbody>
            {b.rows.map((r, ri) => (
              <tr key={ri}>
                {r.cells.map((c, ci) => {
                  const C = b.header && ri === 0 ? "th" : "td"
                  return (
                    <C key={ci} style={c.align ? { textAlign: c.align } : undefined}>
                      <p>
                        <Inlines content={c.content} ctx={ctx} />
                      </p>
                    </C>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case "image":
      return (
        <figure className="w2-figure" data-bid={b.id}>
          <img src={b.src} alt={b.alt ?? ""} style={{ width: b.width ?? "100%" }} />
          {b.caption && <figcaption className="w2-caption">{b.caption}</figcaption>}
        </figure>
      )
    case "chart":
      return (
        <div className="w2-chart-node" data-bid={b.id}>
          <DocChart spec={b} accent={resolveTheme(ctx.meta).accent} />
        </div>
      )
    case "divider":
      return <hr data-bid={b.id} />
    case "pagebreak":
      return <div className="w2-pagebreak" data-bid={b.id} />
    case "toc": {
      const items = outline(ctx.doc).filter((o) => o.level <= (b.depth ?? 3))
      return (
        <nav className="w2-toc" data-bid={b.id}>
          <div className="w2-toc-title">{b.title ?? "Contents"}</div>
          {items.map((o) => (
            <a key={o.id} className="w2-toc-item" data-level={o.level} href={`#${o.id}`}>
              <span className="w2-toc-text">
                {ctx.meta.numberedHeadings && <span className="w2-toc-num">{o.number}</span>}
                {o.text}
              </span>
              {ctx.showPages && <span className="w2-toc-page">{ctx.pageOf?.get(o.id) ?? ""}</span>}
            </a>
          ))}
        </nav>
      )
    }
    case "references": {
      const refs = bibliography(ctx.doc)
      return (
        <section className="w2-references" data-bid={b.id}>
          <h2 className="w2-references-title">{b.title ?? "References"}</h2>
          <ol className={ctx.meta.citationStyle === "numeric" ? "w2-refs-numeric" : "w2-refs"}>
            {refs.map((r) => (
              <li key={r.id}>{formatReference(r)}</li>
            ))}
          </ol>
        </section>
      )
    }
  }
}

/** Footnotes contained in a block, in order. */
export function blockFootnotes(b: Block): FootnoteNode[] {
  const out: FootnoteNode[] = []
  const visitInl = (c: Inline[]) => c.forEach((n) => n.type === "footnote" && out.push(n))
  const visit = (x: Block) => {
    if (x.type === "paragraph" || x.type === "heading") visitInl(x.content)
    else if (x.type === "table") x.rows.forEach((r) => r.cells.forEach((c) => visitInl(c.content)))
    else if (x.type === "list") x.items.forEach((i) => i.blocks.forEach(visit))
    else if ("blocks" in x) x.blocks.forEach(visit)
  }
  visit(b)
  return out
}
