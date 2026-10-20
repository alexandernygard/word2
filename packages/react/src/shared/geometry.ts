import { MM_TO_PX, pageDimensions, pageSetup, type DocMeta } from "@word2/sdk"

export type PageGeometry = {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
  contentWidth: number
  contentHeight: number
}

/** Page geometry in CSS pixels (96 dpi). */
export function pageGeometry(meta: DocMeta): PageGeometry {
  const s = pageSetup(meta)
  const d = pageDimensions(s)
  const px = (mm: number) => Math.round(mm * MM_TO_PX)
  const g = {
    width: px(d.width),
    height: px(d.height),
    top: px(s.margins.top),
    right: px(s.margins.right),
    bottom: px(s.margins.bottom),
    left: px(s.margins.left),
  }
  return { ...g, contentWidth: g.width - g.left - g.right, contentHeight: g.height - g.top - g.bottom }
}

export const PAGE_GAP = 28
