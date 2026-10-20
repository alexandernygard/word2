import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@alexandernygard/components"
import { pageSetup, resolveTheme, THEMES, type DocMeta, type PageSize } from "@word2/sdk"
import { useStore } from "../store"

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>
}

export function PageSetupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const meta = useStore((s) => s.doc.meta)
  const setup = pageSetup(meta)
  const theme = resolveTheme(meta)
  const update = (patch: Partial<DocMeta>) => useStore.getState().updateMeta(patch)
  const margin = (k: "top" | "right" | "bottom" | "left", v: string) => update({ page: { ...meta.page, margins: { ...setup.margins, [k]: Number(v) || 0 } } })
  const ai = (meta.ai ?? {}) as Record<string, string>

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Document setup</DialogTitle>
          <DialogDescription>Stored in the document's front matter, so it travels with the code.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="page">
          <TabsList className="w-full">
            <TabsTrigger value="page">Page</TabsTrigger>
            <TabsTrigger value="hf">Header & footer</TabsTrigger>
            <TabsTrigger value="style">Style</TabsTrigger>
            <TabsTrigger value="brief">AI brief</TabsTrigger>
          </TabsList>
          <TabsContent value="page" className="space-y-4 pt-3">
            <Row>
              <Field>
                <FieldLabel>Size</FieldLabel>
                <NativeSelect value={setup.size} onChange={(e) => update({ page: { ...meta.page, size: e.target.value as PageSize } })}>
                  {["A4", "Letter", "Legal", "A5"].map((s) => (
                    <NativeSelectOption key={s} value={s}>
                      {s}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>Orientation</FieldLabel>
                <NativeSelect value={setup.orientation} onChange={(e) => update({ page: { ...meta.page, orientation: e.target.value as "portrait" } })}>
                  <NativeSelectOption value="portrait">Portrait</NativeSelectOption>
                  <NativeSelectOption value="landscape">Landscape</NativeSelectOption>
                </NativeSelect>
              </Field>
            </Row>
            <div className="grid grid-cols-4 gap-2">
              {(["top", "right", "bottom", "left"] as const).map((k) => (
                <Field key={k}>
                  <FieldLabel className="capitalize">{k} (mm)</FieldLabel>
                  <Input type="number" defaultValue={setup.margins[k]} onBlur={(e) => margin(k, e.target.value)} />
                </Field>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="hf" className="space-y-4 pt-3">
            <Field>
              <FieldLabel>Header</FieldLabel>
              <Input defaultValue={meta.header ?? ""} placeholder="{{title}} | | {{section}}" onBlur={(e) => update({ header: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel>Footer</FieldLabel>
              <Input defaultValue={meta.footer ?? ""} placeholder=" | Page {{page}} of {{pages}} | " onBlur={(e) => update({ footer: e.target.value })} />
              <FieldDescription>
                <code>left | center | right</code>. Fields: {"{{page}} {{pages}} {{title}} {{author}} {{date}} {{section}}"}
              </FieldDescription>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!meta.titlePage} onCheckedChange={(v) => update({ titlePage: v || undefined })} /> No header/footer on the first page
            </label>
          </TabsContent>
          <TabsContent value="style" className="space-y-4 pt-3">
            <Row>
              <Field>
                <FieldLabel>Theme</FieldLabel>
                <NativeSelect value={meta.theme ?? "classic"} onChange={(e) => update({ theme: e.target.value })}>
                  {Object.values(THEMES).map((t) => (
                    <NativeSelectOption key={t.name} value={t.name}>
                      {t.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>Body size (pt)</FieldLabel>
                <Input type="number" step="0.5" defaultValue={theme.fontSize} onBlur={(e) => update({ styles: { ...meta.styles, fontSize: Number(e.target.value) } })} />
              </Field>
            </Row>
            <Row>
              <Field>
                <FieldLabel>Accent colour</FieldLabel>
                <Input type="color" value={theme.accent} onChange={(e) => update({ styles: { ...meta.styles, accent: e.target.value } })} />
              </Field>
              <Field>
                <FieldLabel>Citations</FieldLabel>
                <NativeSelect value={meta.citationStyle ?? "author-date"} onChange={(e) => update({ citationStyle: e.target.value as "numeric" })}>
                  <NativeSelectOption value="author-date">Author–date</NativeSelectOption>
                  <NativeSelectOption value="numeric">Numeric</NativeSelectOption>
                </NativeSelect>
              </Field>
            </Row>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!meta.numberedHeadings} onCheckedChange={(v) => update({ numberedHeadings: v || undefined })} /> Numbered headings (1, 1.1, 1.1.1)
            </label>
          </TabsContent>
          <TabsContent value="brief" className="space-y-4 pt-3">
            <p className="text-sm text-muted-foreground">Claude reads this with every request, so you don't have to repeat it.</p>
            {(["audience", "tone", "purpose"] as const).map((k) => (
              <Field key={k}>
                <FieldLabel className="capitalize">{k}</FieldLabel>
                <Textarea rows={2} defaultValue={ai[k] ?? ""} onBlur={(e) => update({ ai: { ...ai, [k]: e.target.value } })} />
              </Field>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
