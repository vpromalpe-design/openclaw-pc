/**
 * TTS playback helper (v0.9.13, Этап F1).
 * Plays base64 audio pushed from main (`tts:utterance`). One utterance at a
 * time: a new one interrupts the previous (agent answers are sequential).
 */

let current: HTMLAudioElement | null = null

export function playTtsAudio(mime: string, audioBase64: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (current) {
        current.onended = null
        current.onerror = null
        current.pause()
        current.src = ''
        current = null
      }
      const audio = new Audio(`data:${mime};base64,${audioBase64}`)
      current = audio
      const done = () => {
        if (current === audio) current = null
        resolve()
      }
      audio.onended = done
      audio.onerror = done
      audio.play().catch(done)
    } catch {
      resolve()
    }
  })
}
