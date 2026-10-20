import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Textarea } from "@alexandernygard/components"
import { useEffect, useState } from "react"
import { create } from "zustand"

type Prompt = { title: string; description?: string; placeholder?: string; initial?: string; multiline?: boolean; submit: string; onSubmit: (v: string) => void }

export const usePrompt = create<{ prompt: Prompt | null }>(() => ({ prompt: null }))

/** Ask the user for a short value (link URL, comment, image URL...) without window.prompt. */
export function ask(p: Prompt) {
  usePrompt.setState({ prompt: p })
}

export function PromptDialog() {
  const prompt = usePrompt((s) => s.prompt)
  const [value, setValue] = useState("")
  useEffect(() => setValue(prompt?.initial ?? ""), [prompt])
  const close = () => usePrompt.setState({ prompt: null })
  const submit = () => {
    if (!prompt) return
    const v = value.trim()
    close()
    if (v) prompt.onSubmit(v)
  }
  return (
    <Dialog open={!!prompt} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{prompt?.title}</DialogTitle>
          {prompt?.description && <DialogDescription>{prompt.description}</DialogDescription>}
        </DialogHeader>
        {prompt?.multiline ? (
          <Textarea
            autoFocus
            rows={4}
            value={value}
            placeholder={prompt?.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()}
          />
        ) : (
          <Input autoFocus value={value} placeholder={prompt?.placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit}>{prompt?.submit}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
