import type { DocMeta, ThemeOverrides } from "./model"

export type Theme = Required<ThemeOverrides> & { name: string; label: string; headingWeight: number; headingCase?: "none" | "uppercase"; justify?: boolean }

export const THEMES: Record<string, Theme> = {
  classic: {
    name: "classic",
    label: "Classic",
    bodyFont: "'Source Serif 4', Georgia, serif",
    headingFont: "'Source Serif 4', Georgia, serif",
    fontSize: 11,
    lineHeight: 1.5,
    textColor: "#1b1b1b",
    headingColor: "#111111",
    accent: "#2f5d8a",
    headingWeight: 650,
  },
  modern: {
    name: "modern",
    label: "Modern",
    bodyFont: "Inter, system-ui, sans-serif",
    headingFont: "Inter, system-ui, sans-serif",
    fontSize: 10.5,
    lineHeight: 1.55,
    textColor: "#1f2328",
    headingColor: "#0b3d91",
    accent: "#2563eb",
    headingWeight: 700,
  },
  report: {
    name: "report",
    label: "Report",
    bodyFont: "'IBM Plex Sans', system-ui, sans-serif",
    headingFont: "'IBM Plex Sans', system-ui, sans-serif",
    fontSize: 10.5,
    lineHeight: 1.5,
    textColor: "#18212b",
    headingColor: "#18212b",
    accent: "#f2a922",
    headingWeight: 600,
  },
  academic: {
    name: "academic",
    label: "Academic",
    bodyFont: "'Libre Baskerville', 'Source Serif 4', Georgia, serif",
    headingFont: "'Libre Baskerville', 'Source Serif 4', Georgia, serif",
    fontSize: 10.5,
    lineHeight: 1.7,
    textColor: "#222222",
    headingColor: "#222222",
    accent: "#7a1f2b",
    headingWeight: 700,
    justify: true,
  },
}

export function resolveTheme(meta: DocMeta): Theme {
  const base = THEMES[meta.theme ?? "classic"] ?? THEMES.classic
  return { ...base, ...(meta.styles ?? {}) } as Theme
}

/** CSS custom properties for a document theme (applied on the page root). */
export function themeVars(meta: DocMeta): Record<string, string> {
  const t = resolveTheme(meta)
  return {
    "--w2-body-font": t.bodyFont,
    "--w2-heading-font": t.headingFont,
    "--w2-font-size": `${t.fontSize}pt`,
    "--w2-line-height": String(t.lineHeight),
    "--w2-text": t.textColor,
    "--w2-heading": t.headingColor,
    "--w2-accent": t.accent,
    "--w2-heading-weight": String(t.headingWeight),
    "--w2-justify": t.justify ? "justify" : "left",
  }
}
