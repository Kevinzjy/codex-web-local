import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { isLikelyIOS } from '../utils/platform'

function getSpeechRecognitionConstructor(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as Window &
    typeof globalThis & {
      SpeechRecognition?: new () => SpeechRecognition
      webkitSpeechRecognition?: new () => SpeechRecognition
    }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function joinAnchorAndTranscript(anchor: string, transcript: string): string {
  if (!transcript.trim()) return anchor
  if (!anchor) return transcript
  if (/\s$/.test(anchor) || /^\s/.test(transcript)) return anchor + transcript
  return `${anchor} ${transcript}`
}

async function ensureMicPermission(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      signal,
    } as MediaStreamConstraints & { signal?: AbortSignal })
    stream.getTracks().forEach((track) => track.stop())
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw new Error(
        'Microphone blocked. Allow microphone for this site in browser settings, then try again.',
      )
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      throw new Error('No microphone was found on this device.')
    }
    throw new Error('Could not access the microphone.')
  }
}

export function useWebSpeechRecognition() {
  const Ctor = getSpeechRecognitionConstructor()
  const isSupported = Ctor !== null
  const isListening = ref(false)
  /** True while waiting for mic permission or recognition.start() (mobile UX). */
  const isStarting = ref(false)
  const errorMessage = ref('')
  const recognitionRef = shallowRef<SpeechRecognition | null>(null)
  let micRequestController: AbortController | null = null
  let anchorText = ''
  let sessionGeneration = 0

  function clearErrorIfBenign(code: string): boolean {
    return code === 'no-speech' || code === 'aborted'
  }

  function stop(): void {
    micRequestController?.abort()
    micRequestController = null
    const rec = recognitionRef.value
    recognitionRef.value = null
    sessionGeneration += 1
    if (rec) {
      try {
        rec.stop()
      } catch {
        try {
          rec.abort()
        } catch {
          /* ignore */
        }
      }
    }
    isListening.value = false
  }

  async function start(anchor: string, setFullText: (value: string) => void): Promise<void> {
    errorMessage.value = ''
    if (isLikelyIOS()) {
      errorMessage.value =
        'Voice dictation is not supported on iOS (all browsers use WebKit). Type your message or use a desktop browser.'
      return
    }
    if (!Ctor) {
      errorMessage.value = 'Speech recognition is not supported in this browser.'
      return
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      errorMessage.value =
        'Voice input needs a secure context. Use HTTPS or open the app at localhost; plain HTTP to a LAN or Tailscale IP may block the microphone.'
      return
    }

    stop()
    const generation = sessionGeneration
    anchorText = anchor

    micRequestController = new AbortController()
    const micSignal = micRequestController.signal
    isStarting.value = true
    try {
      await ensureMicPermission(micSignal)
    } catch (error) {
      isStarting.value = false
      micRequestController = null
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      errorMessage.value = error instanceof Error ? error.message : 'Could not access the microphone.'
      return
    }
    micRequestController = null

    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US'

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let finalPart = ''
      let interimPart = ''
      for (let i = 0; i < event.results.length; i++) {
        const row = event.results[i]
        const piece = row[0]?.transcript ?? ''
        if (row.isFinal) {
          finalPart += piece
        } else {
          interimPart += piece
        }
      }
      const rest = finalPart + interimPart
      setFullText(joinAnchorAndTranscript(anchorText, rest))
    }

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (clearErrorIfBenign(event.error)) return
      if (event.error === 'not-allowed') {
        errorMessage.value =
          'Microphone permission denied. Allow microphone access in the browser prompt or site settings.'
      } else {
        errorMessage.value = `Speech recognition error: ${event.error}`
      }
      stop()
    }

    rec.onend = () => {
      if (generation !== sessionGeneration) return
      recognitionRef.value = null
      isListening.value = false
    }

    recognitionRef.value = rec
    try {
      rec.start()
      isListening.value = true
    } catch {
      errorMessage.value = 'Could not start speech recognition.'
      recognitionRef.value = null
      isListening.value = false
    } finally {
      isStarting.value = false
    }
  }

  async function toggle(anchor: string, setFullText: (value: string) => void): Promise<void> {
    if (isStarting.value) {
      micRequestController?.abort()
      return
    }
    if (isListening.value) {
      stop()
      return
    }
    await start(anchor, setFullText)
  }

  function clearError(): void {
    errorMessage.value = ''
  }

  onBeforeUnmount(() => {
    stop()
    isStarting.value = false
  })

  return {
    isSupported,
    isListening,
    isStarting,
    errorMessage,
    start,
    stop,
    toggle,
    clearError,
  }
}
