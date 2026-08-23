import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Send, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  error?: boolean
}

type TextChatViewProps = Record<string, never>

/**
 * «Просто текст / Plain text» mode (v0.9.0): a direct model chat with NO agent
 * runtime — no tools, no memory, no compaction. Each exchange goes through
 * IPC `textChat:send` → main → plain completion call with the active model.
 */
export function TextChatView(_props: TextChatViewProps) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)
    const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    try {
      const res = await window.electronAPI.textChatSend({ text, history })
      if (res.ok && res.text) {
        setMessages((prev) => [...prev, { role: 'assistant', content: res.text ?? '' }])
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: res.message ?? t('shell.chat.textError'), error: true },
        ])
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: t('shell.chat.textError'), error: true },
      ])
    } finally {
      setSending(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-2 border-b border-border/80 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t('shell.chat.textModeTitle')}</h2>
          <span className="text-xs text-muted-foreground">{t('shell.chat.textModeHint')}</span>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => setMessages([])}
            disabled={sending}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {t('shell.chat.historyClear')}
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-md text-center text-sm text-muted-foreground">
              {t('shell.chat.textModeHint')}
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : m.error
                    ? 'rounded-bl-sm border border-destructive/40 bg-destructive/10 text-destructive'
                    : 'rounded-bl-sm border border-border bg-card text-foreground'
              }`}
            >
              {m.error && (
                <span className="mr-1.5 inline-flex items-center gap-1 text-xs font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
              )}
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('shell.chat.sending')}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border/80 bg-background/80 p-3 backdrop-blur">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('shell.chat.textPlaceholder')}
            rows={2}
            className="max-h-40 min-h-[44px] flex-1 resize-none"
          />
          <Button
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full"
            onClick={() => void handleSend()}
            disabled={sending || !input.trim()}
            aria-label={t('shell.chat.send')}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
