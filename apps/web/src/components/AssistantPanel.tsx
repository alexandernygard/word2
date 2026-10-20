import {
  Alert,
  AlertDescription,
  Bubble,
  BubbleContent,
  Button,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
  Marker,
  MarkerContent,
  MarkerIcon,
  Message,
  MessageContent,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  NativeSelect,
  NativeSelectOption,
  Spinner,
  Switch,
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@alexandernygard/components"
import { ArrowUpIcon, FilePenLineIcon, KeyRoundIcon, MessageSquarePlusIcon, RotateCcwIcon, SettingsIcon, SparklesIcon, SquareIcon, WandSparklesIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { QUICK_ACTIONS, askClaude, resetConversation, stopAgent } from "../ai/useAgent"
import { useStore, type ChatItem } from "../store"

const TOOL_LABEL: Record<string, string> = {
  write_document: "Drafting the document",
  edit_blocks: "Proposing edits",
  insert_blocks: "Inserting blocks",
  add_comment: "Adding a comment",
  reply_to_comment: "Replying to a comment",
  update_settings: "Updating settings",
}

const STARTERS = [
  { label: "Draft a project proposal", prompt: "Draft a 2-page project proposal for a community solar co-op in Utrecht: problem, plan, budget table, timeline, risks. Use the report theme." },
  { label: "Tighten the summary", prompt: "Tighten the Summary section. Keep the numbers." },
  { label: "Chart the channel table", prompt: "Add a line chart showing each channel's change, based on the channel table." },
  { label: "Address @claude comments", prompt: QUICK_ACTIONS.comments.prompt },
]

function KeySetup() {
  const [key, setKey] = useState("")
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRoundIcon className="size-4" /> Connect Claude
      </div>
      <p className="text-sm text-muted-foreground">
        Paste an Anthropic API key. It's kept in this browser's local storage and sent only to api.anthropic.com — there's no word2 server.
      </p>
      <Input type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && key && useStore.getState().updateSettings({ apiKey: key.trim() })} />
      <Button size="sm" disabled={!key} onClick={() => useStore.getState().updateSettings({ apiKey: key.trim() })}>
        Save key
      </Button>
    </div>
  )
}

function AssistantMessage({ m }: { m: Extract<ChatItem, { role: "assistant" }> }) {
  const [showThinking, setShowThinking] = useState(false)
  return (
    <Message align="start">
      <MessageContent className="w-full">
        {m.thinking && (
          <button className="text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowThinking((v) => !v)}>
            {showThinking ? "Hide reasoning" : "Show reasoning"}
          </button>
        )}
        {showThinking && <p className="border-l-2 pl-2 text-xs whitespace-pre-wrap text-muted-foreground">{m.thinking}</p>}
        {m.tools.length > 0 && (
          <Trace>
            {m.tools.map((t) => (
              <TraceLine key={t.id}>
                <TraceIcon>{t.summary || t.error ? <FilePenLineIcon /> : <Spinner />}</TraceIcon>
                <TraceTitle>{TOOL_LABEL[t.name] ?? t.name}</TraceTitle>
                <TraceDescription className={t.error ? "text-destructive" : undefined}>
                  {t.summary ?? (t.chars ? `${Math.round(t.chars / 4).toLocaleString()} tokens…` : "…")}
                </TraceDescription>
              </TraceLine>
            ))}
          </Trace>
        )}
        {m.text && (
          <Bubble variant="ghost">
            <BubbleContent className="whitespace-pre-wrap">{m.text}</BubbleContent>
          </Bubble>
        )}
        {!m.done && !m.text && m.tools.every((t) => t.summary) && (
          <Marker role="status">
            <MarkerIcon>
              <Spinner />
            </MarkerIcon>
            <MarkerContent className="shimmer">{m.thinking ? "Thinking" : "Reading the document"}</MarkerContent>
          </Marker>
        )}
        {m.error && (
          <Alert variant="destructive">
            <AlertDescription>{m.error}</AlertDescription>
          </Alert>
        )}
        {m.done && m.checkpoint !== undefined && m.tools.some((t) => t.summary && !t.error) && (
          <div>
            <Button
              size="xs"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => useStore.getState().restore(m.checkpoint!)}
              title="Restore the document to how it was before this request"
            >
              <RotateCcwIcon /> Undo this turn
            </Button>
          </div>
        )}
      </MessageContent>
    </Message>
  )
}

export function AssistantPanel() {
  const chat = useStore((s) => s.chat)
  const busy = useStore((s) => s.busy)
  const settings = useStore((s) => s.settings)
  const selection = useStore((s) => s.selection)
  const [draft, setDraft] = useState("")
  const [showSettings, setShowSettings] = useState(false)
  const [needKey, setNeedKey] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const h = () => setNeedKey(true)
    window.addEventListener("w2:need-key", h)
    return () => window.removeEventListener("w2:need-key", h)
  }, [])

  const send = (e?: React.FormEvent) => {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setDraft("")
    askClaude(text)
  }
  const sel = selection && !selection.empty ? selection : null

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <label className="flex items-center gap-2 text-xs" title="When on, Claude's edits arrive as tracked suggestions you accept or reject">
          <Switch checked={settings.suggest} onCheckedChange={(v) => useStore.getState().updateSettings({ suggest: v })} size="sm" />
          Suggest edits
        </label>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" aria-label="Assistant settings" onClick={() => setShowSettings((v) => !v)}>
            <SettingsIcon />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="New chat" onClick={() => resetConversation()} disabled={busy}>
            <MessageSquarePlusIcon />
          </Button>
        </div>
      </div>
      {showSettings && (
        <div className="space-y-2 border-b bg-muted/40 p-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-muted-foreground">Model</span>
              <NativeSelect size="sm" value={settings.model} onChange={(e) => useStore.getState().updateSettings({ model: e.target.value })}>
                <NativeSelectOption value="claude-opus-5-5">Claude Opus 5.5</NativeSelectOption>
                <NativeSelectOption value="claude-sonnet-5-5">Claude Sonnet 5.5</NativeSelectOption>
                <NativeSelectOption value="claude-haiku-5-5">Claude Haiku 5.5</NativeSelectOption>
                <NativeSelectOption value="claude-fable-5-1">Claude Fable 5.1</NativeSelectOption>
              </NativeSelect>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">Effort</span>
              <NativeSelect size="sm" value={settings.effort} onChange={(e) => useStore.getState().updateSettings({ effort: e.target.value as "low" })}>
                {["low", "medium", "high", "xhigh", "max"].map((x) => (
                  <NativeSelectOption key={x} value={x}>
                    {x}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2" title="Your own edits become tracked suggestions">
              <Switch checked={settings.trackChanges} onCheckedChange={(v) => useStore.getState().updateSettings({ trackChanges: v })} size="sm" />
              Track my changes as
            </label>
            <Input className="h-7 w-28 text-xs" aria-label="Your name on tracked changes" value={settings.author} onChange={(e) => useStore.getState().updateSettings({ author: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">API key</span>
            <span className="font-mono">{settings.apiKey ? `${settings.apiKey.slice(0, 10)}…` : "not set"}</span>
            {settings.apiKey && (
              <Button size="xs" variant="ghost" onClick={() => useStore.getState().updateSettings({ apiKey: "" })}>
                Remove
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <MessageScrollerProvider>
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-4 p-3">
                {(!settings.apiKey || needKey) && !settings.apiKey && (
                  <MessageScrollerItem>
                    <KeySetup />
                  </MessageScrollerItem>
                )}
                {chat.length === 0 && (
                  <MessageScrollerItem>
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <SparklesIcon className="size-4 text-highlight" /> Claude works on the document itself
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Ask for a draft and watch it stream into the pages, or select text and ask for a rewrite. Edits arrive as tracked changes, each with a reason, so you keep the final say.
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {STARTERS.map((s) => (
                          <Button key={s.label} variant="outline" size="sm" className="justify-start" onClick={() => askClaude(s.prompt, { display: s.label })}>
                            <WandSparklesIcon /> {s.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </MessageScrollerItem>
                )}
                {chat.map((m) => (
                  <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
                    {m.role === "user" ? (
                      <Message align="end">
                        <MessageContent>
                          {m.context && <span className="self-end text-[11px] text-muted-foreground">{m.context}</span>}
                          <Bubble>
                            <BubbleContent className="whitespace-pre-wrap">{m.text}</BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    ) : (
                      <AssistantMessage m={m} />
                    )}
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      </div>

      <form onSubmit={send} className="shrink-0 border-t p-3">
        {sel && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded bg-highlight/20 px-1.5 py-0.5 font-medium text-foreground">
              {sel.blockIds.length} block{sel.blockIds.length === 1 ? "" : "s"} selected
            </span>
            <span className="truncate">“{sel.text.slice(0, 60)}”</span>
          </div>
        )}
        <InputGroup>
          <InputGroupTextarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) send(e)
            }}
            placeholder={sel ? "What should change in the selection?" : "Ask Claude to draft, edit, or restructure…"}
            className="max-h-40 min-h-12"
          />
          <InputGroupAddon align="block-end">
            <span className="text-[11px] text-muted-foreground">{settings.suggest ? "Edits as suggestions" : "Edits applied directly"}</span>
            {busy ? (
              <InputGroupButton type="button" size="icon-xs" variant="default" className="ml-auto rounded-full" aria-label="Stop" onClick={() => stopAgent()}>
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton type="submit" size="icon-xs" variant="default" className="ml-auto rounded-full" aria-label="Send" disabled={!draft.trim()}>
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  )
}
