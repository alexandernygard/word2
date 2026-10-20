import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@alexandernygard/components"
import type { ChartSpec } from "@word2/sdk"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts"

/** Paper-stable palette (documents are always printed on white, so we don't follow the app's dark mode). */
const PALETTE = ["#2f5d8a", "#f2a922", "#3fa36b", "#c2410c", "#7c3aed", "#0891b2", "#be185d"]

export function chartPalette(accent?: string) {
  return accent ? [accent, ...PALETTE.filter((c) => c.toLowerCase() !== accent.toLowerCase())] : PALETTE
}

export function DocChart({ spec, accent, animate = false }: { spec: ChartSpec; accent?: string; animate?: boolean }) {
  const colors = chartPalette(accent)
  const config: ChartConfig = Object.fromEntries(spec.y.map((y, i) => [y, { label: y, color: colors[i % colors.length] }]))
  const common = { data: spec.data, margin: { top: 8, right: 12, left: 0, bottom: 0 } }
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="#e5e7eb" />
      <XAxis dataKey={spec.x} tickLine={false} axisLine={false} tickMargin={8} tick={{ fill: "#6b7280" }} />
      <YAxis tickLine={false} axisLine={false} width={40} tick={{ fill: "#6b7280" }} />
      <ChartTooltip content={<ChartTooltipContent />} />
      {spec.y.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
    </>
  )
  let chart
  if (spec.chart === "pie") {
    const key = spec.y[0]
    const pieConfig: ChartConfig = Object.fromEntries(
      spec.data.map((d, i) => [String(d[spec.x]), { label: String(d[spec.x]), color: colors[i % colors.length] }]),
    )
    return (
      <figure className="w2-chart">
        {spec.title && <figcaption className="w2-chart-title">{spec.title}</figcaption>}
        <ChartContainer config={{ ...config, ...pieConfig }} className="aspect-auto h-[240px] w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey={spec.x} />} />
            <Pie data={spec.data} dataKey={key} nameKey={spec.x} innerRadius={50} outerRadius={90} isAnimationActive={animate}>
              {spec.data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <ChartLegend content={<ChartLegendContent nameKey={spec.x} />} />
          </PieChart>
        </ChartContainer>
        {spec.caption && <figcaption className="w2-caption">{spec.caption}</figcaption>}
      </figure>
    )
  }
  if (spec.chart === "line")
    chart = (
      <LineChart {...common}>
        {axes}
        {spec.y.map((y, i) => (
          <Line key={y} dataKey={y} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} isAnimationActive={animate} />
        ))}
      </LineChart>
    )
  else if (spec.chart === "area")
    chart = (
      <AreaChart {...common}>
        {axes}
        {spec.y.map((y, i) => (
          <Area
            key={y}
            dataKey={y}
            stroke={colors[i % colors.length]}
            fill={colors[i % colors.length]}
            fillOpacity={0.25}
            stackId={spec.stacked ? "s" : undefined}
            isAnimationActive={animate}
          />
        ))}
      </AreaChart>
    )
  else
    chart = (
      <BarChart {...common}>
        {axes}
        {spec.y.map((y, i) => (
          <Bar key={y} dataKey={y} fill={colors[i % colors.length]} radius={3} stackId={spec.stacked ? "s" : undefined} isAnimationActive={animate} />
        ))}
      </BarChart>
    )
  return (
    <figure className="w2-chart">
      {spec.title && <figcaption className="w2-chart-title">{spec.title}</figcaption>}
      <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
        {chart}
      </ChartContainer>
      {spec.caption && <figcaption className="w2-caption">{spec.caption}</figcaption>}
    </figure>
  )
}
