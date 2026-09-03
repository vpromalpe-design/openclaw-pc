import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Mic, Square, Send, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { recordMic } from '@/utils/mic-recorder'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  error?: boolean
}

export type { ChatMessage }

type TextChatViewProps = {
  /** v0.9.8: history lives in the shell so mode switches don't wipe it. */
  history: ChatMessage[]
  onHistoryChange: React.Dispatch<React.SetStateAction<ChatMessage[]>>
}

/**
 * «Просто текст / Plain text» mode (v0.9.0): a direct model chat with NO agent
 * runtime — no tools, no memory, no compaction. Each exchange goes through
 * IPC `textChat:send` → main → plain completion call with the active model.
 */
export function TextChatView({ history, onHistoryChange }: TextChatViewProps) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sttReady, setSttReady] = useState(false)
  const [dictating, setDictating] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [dictError, setDictError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const stopDictationRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI
      .sttLoad()
      .then((res) => {
        if (!cancelled) {
          setSttReady(res.whisper.installed && res.whisper.modelsInstalled.includes(res.model))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      stopDictationRef.current?.()
    }
  }, [])

  /** Toggle mic dictation: press → record, press again → transcribe into input. */
  const toggleDictate = async () => {
    if (dictating) {
      stopDictationRef.current?.()
      return
    }
    setDictError(null)
    setDictating(true)
    let stopResolve: () => void = () => undefined
    const stopSignal = new Promise<void>((r) => {
      stopResolve = r
    })
    stopDictationRef.current = stopResolve
    try {
      const audioBase64 = await recordMic({ stopSignal, maxMs: 15000 })
      setDictating(false)
      setTranscribing(true)
      const res = await window.electronAPI.sttTranscribe({ audioBase64 })
      if (res.ok && res.text) {
        setInput((prev) => (prev.trim() ? `${prev.trim()} ${res.text}` : res.text!))
      } else {
        setDictError(res.error ?? t('voice.stt.transcribeFailed'))
      }
    } catch (e) {
      setDictating(false)
      setDictError(e instanceof Error ? e.message : t('voice.stt.transcribeFailed'))
    } finally {
      setTranscribing(false)
      stopDictationRef.current = null
    }
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history, sending])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)
    const prev = history
    const historyForCall = prev.slice(-10).map((m) => ({ role: m.role, content: m.content }))
    onHistoryChange([...prev, { role: 'user', content: text }])
    try {
      const res = await window.electronAPI.textChatSend({ text, history: historyForCall })
      if (res.ok && res.text) {
        onHistoryChange((current) => [
          ...current,
          { role: 'assistant', content: res.text ?? '' },
        ])
      } else {
        // v0.10.2: local-engine failures carry a machine-readable code so the
        // user sees a real hint («start the engine in Models») instead of a raw
        // fetch/ECONNREFUSED message. Damir 2026-09-03: «gemma выбрана, а
        // сообщения не отправляются» — the engine was not actually running.
        const known =
          res.code === 'LOCAL_ENGINE_NOT_RUNNING' || res.code === 'LOCAL_ENGINE_UNREACHABLE'
            ? t('shell.chat.localEngineDown')
            : null
        onHistoryChange((current) => [
          ...current,
          {
            role: 'assistant',
            content: known ?? res.message ?? t('shell.chat.textError'),
            error: true,
          },
        ])
      }
    } catch {
      onHistoryChange((current) => [
        ...current,
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
        {history.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => onHistoryChange([])}
            disabled={sending}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {t('shell.chat.historyClear')}
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {history.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-md text-center text-sm text-muted-foreground">
              {t('shell.chat.textModeHint')}
            </p>
          </div>
        )}
        {history.map((m, i) => (
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
        {(dictating || transcribing || dictError) && (
          <div
            className={`mb-2 flex items-center gap-2 text-xs ${
              dictError ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {dictating ? (
          <>
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-destructive" />
                {t('voice.stt.recording')}
          </>
            ) : transcribing ? (
          <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('voice.stt.transcribing')}
          </>
            ) : (
          <>
                <AlertTriangle className="h-3 w-3" />
                {dictError}
          </>
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button
            size="icon"
            variant={dictating ? 'destructive' : 'ghost'}
            className="h-11 w-11 shrink-0 rounded-full"
            onClick={() => void toggleDictate()}
            disabled={transcribing || sending || !sttReady}
            title={
              sttReady
                ? t('voice.stt.micHint')
                : t('voice.stt.notInstalled')
            }
            aria-label={t('voice.stt.record')}
          >
            {dictating ? (
              <Square className="h-4 w-4" />
            ) : transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
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
