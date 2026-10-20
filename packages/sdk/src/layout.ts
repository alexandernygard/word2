/**
 * Pagination: given measured block heights, decide where pages break.
 * Shared by the read-only page renderer and the editor's pagination plugin.
 *
 * Breaks happen between top-level blocks (a block taller than a page overflows
 * its page rather than being split; see README "limitations").
 */
export type LayoutItem = {
  height: number
  /** explicit page break block: always ends the page */
  pageBreak?: boolean
  /** keep with the next block (headings) */
  keepWithNext?: boolean
  /** height of footnotes this block contributes to its page */
  footnoteHeight?: number
}

export type PageSlice = { start: number; end: number; used: number; footnoteHeight: number }

export function paginate(items: LayoutItem[], contentHeight: number, footnoteGap = 16): PageSlice[] {
  const pages: PageSlice[] = []
  let start = 0
  let used = 0
  let fn = 0
  const close = (end: number) => {
    pages.push({ start, end, used, footnoteHeight: fn })
    start = end
    used = 0
    fn = 0
  }
  const fnCost = (it: LayoutItem) => (it.footnoteHeight ? it.footnoteHeight + (fn === 0 ? footnoteGap : 0) : 0)
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.pageBreak) {
      close(i + 1)
      continue
    }
    let need = it.height + fnCost(it)
    // keep headings with (the start of) the following block
    if (it.keepWithNext && items[i + 1] && !items[i + 1].pageBreak) need += Math.min(items[i + 1].height, 48)
    if (i > start && used + fn + need > contentHeight) close(i)
    fn += fnCost(it)
    used += it.height
  }
  if (start < items.length || pages.length === 0) close(items.length)
  return pages
}
