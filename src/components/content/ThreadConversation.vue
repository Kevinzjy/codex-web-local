<template>
  <section class="conversation-root">
    <p v-if="showLoadingState" class="conversation-loading">{{ LOADING_MESSAGES_TEXT }}</p>

    <p
      v-else-if="showEmptyState"
      class="conversation-empty"
    >
      No messages in this thread yet.
    </p>

    <ul
      v-else
      ref="conversationListRef"
      class="conversation-list codex-subtle-scroll"
      @scroll="onConversationScroll"
      @wheel.passive="scheduleUserScrollStateSync"
    >
      <li
        v-for="request in pendingRequests"
        :key="`server-request:${request.id}`"
        class="conversation-item conversation-item-request"
      >
        <div class="message-row">
          <div class="message-stack">
            <article class="request-card">
              <p class="request-title">{{ request.method }}</p>
              <p class="request-meta">Request #{{ request.id }} · {{ formatIsoTime(request.receivedAtIso) }}</p>

              <p v-if="readRequestReason(request)" class="request-reason">{{ readRequestReason(request) }}</p>

              <section v-if="request.method === 'item/commandExecution/requestApproval'" class="request-actions">
                <button type="button" class="request-button request-button-primary" @click="onRespondApproval(request.id, 'accept')">Accept</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'acceptForSession')">Accept for Session</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'decline')">Decline</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'cancel')">Cancel</button>
              </section>

              <section v-else-if="request.method === 'item/fileChange/requestApproval'" class="request-actions">
                <button type="button" class="request-button request-button-primary" @click="onRespondApproval(request.id, 'accept')">Accept</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'acceptForSession')">Accept for Session</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'decline')">Decline</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'cancel')">Cancel</button>
              </section>

              <section v-else-if="request.method === 'item/tool/requestUserInput'" class="request-user-input">
                <div
                  v-for="question in readToolQuestions(request)"
                  :key="`${request.id}:${question.id}`"
                  class="request-question"
                >
                  <p class="request-question-title">{{ question.header || question.question }}</p>
                  <p v-if="question.header && question.question" class="request-question-text">{{ question.question }}</p>
                  <select
                    :id="`tool-request-${request.id}-${question.id}-answer`"
                    class="request-select"
                    :name="`tool-request-${request.id}-${question.id}-answer`"
                    :value="readQuestionAnswer(request.id, question.id, question.options[0] || '')"
                    autocomplete="off"
                    @change="onQuestionAnswerChange(request.id, question.id, $event)"
                  >
                    <option v-for="option in question.options" :key="`${request.id}:${question.id}:${option}`" :value="option">
                      {{ option }}
                    </option>
                  </select>
                  <input
                    v-if="question.isOther"
                    :id="`tool-request-${request.id}-${question.id}-other`"
                    class="request-input"
                    type="text"
                    :name="`tool-request-${request.id}-${question.id}-other`"
                    :value="readQuestionOtherAnswer(request.id, question.id)"
                    placeholder="Other answer"
                    autocomplete="off"
                    @input="onQuestionOtherAnswerInput(request.id, question.id, $event)"
                  />
                </div>

                <button type="button" class="request-button request-button-primary" @click="onRespondToolRequestUserInput(request)">
                  Submit Answers
                </button>
              </section>

              <section v-else-if="request.method === 'item/tool/call'" class="request-actions">
                <button type="button" class="request-button request-button-primary" @click="onRespondToolCallFailure(request.id)">Fail Tool Call</button>
                <button type="button" class="request-button" @click="onRespondToolCallSuccess(request.id)">Success (Empty)</button>
              </section>

              <section v-else class="request-actions">
                <button type="button" class="request-button request-button-primary" @click="onRespondEmptyResult(request.id)">Return Empty Result</button>
                <button type="button" class="request-button" @click="onRejectUnknownRequest(request.id)">Reject Request</button>
              </section>
            </article>
          </div>
        </div>
      </li>

      <li
        v-for="message in messages"
        :key="message.id"
        class="conversation-item"
        :data-role="message.role"
        :data-message-type="message.messageType || ''"
      >
        <div class="message-row" :data-role="message.role" :data-message-type="message.messageType || ''">
          <div class="message-stack" :data-role="message.role">
            <article class="message-body" :data-role="message.role">
              <ul
                v-if="message.images && message.images.length > 0"
                class="message-image-list"
                :data-role="message.role"
              >
                <li v-for="imageUrl in message.images" :key="imageUrl" class="message-image-item">
                  <button class="message-image-button" type="button" @click="openImageModal(imageUrl)">
                    <img class="message-image-preview" :src="imageUrl" alt="Message image preview" loading="lazy" />
                  </button>
                </li>
              </ul>

              <article v-if="message.text.length > 0" class="message-card" :data-role="message.role">
                <div v-if="message.messageType === 'worked'" class="worked-separator" aria-live="polite">
                  <span class="worked-separator-line" aria-hidden="true" />
                  <p class="worked-separator-text">{{ message.text }}</p>
                  <span class="worked-separator-line" aria-hidden="true" />
                </div>
                <pre
                  v-else-if="message.messageType === 'clientSlash.status'"
                  class="message-slasht-status"
                  >{{ message.text }}</pre
                >
                <div
                  v-else-if="message.messageType === 'clientBang.command'"
                  class="message-bang-card"
                >
                  <p class="message-bang-header">{{ parseBangHeader(message.text) }}</p>
                  <div class="message-bang-output-wrap">
                    <button
                      type="button"
                      class="message-code-copy"
                      :aria-label="isCopied(`bang:${message.id}`) ? 'Copied' : 'Copy output'"
                      @click="copyText(`bang:${message.id}`, parseBangOutput(message.text))"
                    >
                      <IconTablerCheck v-if="isCopied(`bang:${message.id}`)" class="message-code-copy-icon" />
                      <IconTablerCopy v-else class="message-code-copy-icon" />
                    </button>
                    <pre class="message-bang-output">{{ parseBangOutput(message.text) }}</pre>
                  </div>
                </div>
                <template v-else>
                  <template v-for="(block, bIdx) in parseMessageBlocks(message.text)" :key="`blk-${message.id}-${bIdx}`">
                    <div
                      v-if="block.kind === 'code'"
                      class="message-code-block-wrap"
                    >
                      <button
                        type="button"
                        class="message-code-copy"
                        :aria-label="isCopied(`code:${message.id}:${bIdx}`) ? 'Copied' : 'Copy code block'"
                        @click="copyText(`code:${message.id}:${bIdx}`, block.code)"
                      >
                        <IconTablerCheck v-if="isCopied(`code:${message.id}:${bIdx}`)" class="message-code-copy-icon" />
                        <IconTablerCopy v-else class="message-code-copy-icon" />
                      </button>
                      <pre class="message-code-block"><code class="message-code-block-inner">{{ block.code }}</code></pre>
                    </div>
                    <p v-else-if="block.kind === 'markdown' && block.text.length > 0" class="message-text">
                      <template v-for="(segment, index) in parseInlineSegments(block.text)" :key="`seg-${bIdx}-${index}`">
                        <span v-if="segment.kind === 'text'">{{ segment.value }}</span>
                        <a v-else-if="segment.kind === 'file'" class="message-file-link" href="#" @click.prevent>
                          {{ segment.displayName }}
                        </a>
                        <strong v-else-if="segment.kind === 'bold'" class="message-bold">{{ segment.value }}</strong>
                        <code v-else class="message-inline-code">{{ segment.value }}</code>
                      </template>
                    </p>
                  </template>
                </template>
              </article>
            </article>
          </div>
        </div>
      </li>
      <li v-if="liveOverlay" class="conversation-item conversation-item-overlay">
        <div class="message-row">
          <div class="message-stack">
            <article class="live-overlay-inline" aria-live="polite">
              <p class="live-overlay-label">{{ liveOverlay.activityLabel }}</p>
              <p
                v-if="liveOverlay.reasoningText"
                class="live-overlay-reasoning"
              >
                {{ liveOverlay.reasoningText }}
              </p>
              <p v-if="liveOverlay.errorText" class="live-overlay-error">{{ liveOverlay.errorText }}</p>
            </article>
          </div>
        </div>
      </li>
      <li ref="bottomAnchorRef" class="conversation-bottom-anchor" />
    </ul>

    <div v-if="modalImageUrl.length > 0" class="image-modal-backdrop" @click="closeImageModal">
      <div class="image-modal-content" @click.stop>
        <button class="image-modal-close" type="button" aria-label="Close image preview" @click="closeImageModal">
          <IconTablerX class="icon-svg" />
        </button>
        <img class="image-modal-image" :src="modalImageUrl" alt="Expanded message image" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  ThreadScrollState,
  UiLiveOverlay,
  UiMessage,
  UiServerRequest,
  UiServerRequestId,
  UiServerRequestReply,
} from '../../types/codex'
import IconTablerX from '../icons/IconTablerX.vue'
import IconTablerCopy from '../icons/IconTablerCopy.vue'
import IconTablerCheck from '../icons/IconTablerCheck.vue'

const props = defineProps<{
  messages: UiMessage[]
  pendingRequests: UiServerRequest[]
  liveOverlay: UiLiveOverlay | null
  isLoading: boolean
  hasLoadedMessages: boolean
  activeThreadId: string
  scrollState: ThreadScrollState | null
  workingDirectory: string
}>()

const emit = defineEmits<{
  updateScrollState: [payload: { threadId: string; state: ThreadScrollState }]
  respondServerRequest: [payload: UiServerRequestReply]
}>()

const conversationListRef = ref<HTMLElement | null>(null)
const bottomAnchorRef = ref<HTMLElement | null>(null)
const modalImageUrl = ref('')
const toolQuestionAnswers = ref<Record<string, string>>({})
const toolQuestionOtherAnswers = ref<Record<string, string>>({})
const copiedBlockId = ref('')
let copiedBlockResetTimer: number | null = null
const LOADING_MESSAGES_TEXT = 'Loading messages in this thread.'
const BOTTOM_THRESHOLD_PX = 16
const NEAR_BOTTOM_SCROLL_RATIO = 0.999
const showLoadingState = computed(
  () =>
    props.isLoading ||
    (!props.hasLoadedMessages &&
      props.messages.length === 0 &&
      props.pendingRequests.length === 0 &&
      !props.liveOverlay),
)
const showEmptyState = computed(
  () =>
    !showLoadingState.value &&
    props.messages.length === 0 &&
    props.pendingRequests.length === 0 &&
    !props.liveOverlay,
)
type InlineSegment =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'file'; value: string; displayName: string }

type MessageBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'code'; language: string; code: string }

let scrollRestoreFrame = 0
let scrollRestoreGuardFrame = 0
let userScrollStateFrame = 0
let bottomLockFrame = 0
let bottomLockFramesLeft = 0
let isRestoringScrollState = false
const trackedPendingImages = new WeakSet<HTMLImageElement>()

type ParsedToolQuestion = {
  id: string
  header: string
  question: string
  isOther: boolean
  options: string[]
}

function isFilePath(value: string): boolean {
  if (!value || /\s/u.test(value)) return false
  if (value.endsWith('/') || value.endsWith('\\')) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)) return false

  const looksLikeUnixAbsolute = value.startsWith('/')
  const looksLikeWindowsAbsolute = /^[A-Za-z]:[\\/]/u.test(value)
  const looksLikeRelative = value.startsWith('./') || value.startsWith('../') || value.startsWith('~/')
  const hasPathSeparator = value.includes('/') || value.includes('\\')
  return looksLikeUnixAbsolute || looksLikeWindowsAbsolute || looksLikeRelative || hasPathSeparator
}

function getBasename(pathValue: string): string {
  const normalized = pathValue.replace(/\\/gu, '/')
  const name = normalized.split('/').filter(Boolean).pop()
  return name || pathValue
}

function normalizeDisplayPath(pathValue: string): string {
  return pathValue.replace(/\\/gu, '/')
}

function stripTrailingSlash(pathValue: string): string {
  return pathValue.replace(/\/+$/u, '')
}

function isPathWithDirectory(pathValue: string): boolean {
  return pathValue.includes('/') || pathValue.includes('\\')
}

function formatFileDisplayPath(fileReference: { path: string; line: number | null }, label?: string): string {
  const labelText = label?.trim() ?? ''
  const normalizedPath = normalizeDisplayPath(fileReference.path)
  const normalizedCwd = stripTrailingSlash(normalizeDisplayPath(props.workingDirectory.trim()))

  let displayPath = normalizedPath
  if (normalizedCwd && normalizedPath.startsWith(`${normalizedCwd}/`)) {
    displayPath = normalizedPath.slice(normalizedCwd.length + 1)
  } else if (normalizedPath.startsWith('./')) {
    displayPath = normalizedPath.slice(2)
  } else if (!isPathWithDirectory(normalizedPath) && labelText) {
    displayPath = labelText
  } else if (!isPathWithDirectory(normalizedPath) && !labelText) {
    displayPath = getBasename(normalizedPath)
  }

  if (labelText && isPathWithDirectory(labelText) && !normalizedCwd) {
    displayPath = normalizeDisplayPath(labelText)
  }

  return fileReference.line ? `${displayPath}:${String(fileReference.line)}` : displayPath
}

function parseFileReference(value: string): { path: string; line: number | null } | null {
  if (!value) return null

  let pathValue = value.trim()
  let line: number | null = null

  const hashLineMatch = pathValue.match(/^(.*)#L(\d+)(?:C\d+)?$/u)
  if (hashLineMatch) {
    pathValue = hashLineMatch[1]
    line = Number(hashLineMatch[2])
  } else {
    const colonLineMatch = pathValue.match(/^(.*):(\d+)(?::\d+)?$/u)
    if (colonLineMatch) {
      pathValue = colonLineMatch[1]
      line = Number(colonLineMatch[2])
    }
  }

  if (!isFilePath(pathValue)) return null
  return { path: pathValue, line }
}

function createFileSegment(value: string, label?: string): InlineSegment | null {
  const fileReference = parseFileReference(value)
  if (!fileReference) return null

  const displayName = formatFileDisplayPath(fileReference, label)
  return { kind: 'file', value, displayName }
}

function parseMarkdownFileLinkAt(text: string, start: number): { segment: InlineSegment; end: number } | null {
  if (text[start] !== '[') return null

  const labelEnd = text.indexOf(']', start + 1)
  if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null

  const targetStart = labelEnd + 2
  const targetEnd = text.indexOf(')', targetStart)
  if (targetEnd < 0) return null

  const label = text.slice(start + 1, labelEnd)
  const target = text.slice(targetStart, targetEnd)
  if (label.includes('\n') || target.includes('\n')) return null

  const segment = createFileSegment(target, label)
  if (!segment) return null
  return { segment, end: targetEnd + 1 }
}

function parseBoldAt(text: string, start: number): { segment: InlineSegment; end: number } | null {
  if (!text.startsWith('**', start)) return null
  if (text[start + 2] === '*') return null

  const valueStart = start + 2
  const closingStart = text.indexOf('**', valueStart)
  if (closingStart < 0) return null

  const value = text.slice(valueStart, closingStart)
  if (value.trim().length === 0 || value.includes('\n')) return null

  return {
    segment: { kind: 'bold', value },
    end: closingStart + 2,
  }
}

/**
 * Split markdown-style fenced code blocks (``` ... ```) from the rest of the message.
 * Multiline blocks are not handled by parseInlineSegments alone because inline backtick pairs
 * require no newline inside the token.
 */
function parseMessageBlocks(text: string): MessageBlock[] {
  if (!text.includes('```')) {
    return [{ kind: 'markdown', text }]
  }

  const blocks: MessageBlock[] = []
  const lines = text.split('\n')
  const paragraphLines: string[] = []
  let inFence = false
  let fenceLang = ''
  const codeLines: string[] = []

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return
    const joined = paragraphLines.join('\n')
    if (joined.length > 0) {
      blocks.push({ kind: 'markdown', text: joined })
    }
    paragraphLines.length = 0
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (inFence) {
      if (trimmed === '```') {
        blocks.push({ kind: 'code', language: fenceLang, code: codeLines.join('\n') })
        inFence = false
        fenceLang = ''
        codeLines.length = 0
      } else {
        codeLines.push(line)
      }
      continue
    }

    if (trimmed.startsWith('```')) {
      const rest = trimmed.slice(3).trim()
      const lang = rest.length === 0 ? '' : (rest.split(/\s+/)[0] ?? '')
      flushParagraph()
      inFence = true
      fenceLang = lang
      codeLines.length = 0
      continue
    }

    paragraphLines.push(line)
  }

  if (inFence) {
    paragraphLines.push(`\`\`\`${fenceLang}`)
    for (const cl of codeLines) {
      paragraphLines.push(cl)
    }
  }

  flushParagraph()
  return blocks.length > 0 ? blocks : [{ kind: 'markdown', text }]
}

function parseInlineSegments(text: string): InlineSegment[] {
  if (!text.includes('`') && !text.includes('](') && !text.includes('**')) {
    return [{ kind: 'text', value: text }]
  }

  const segments: InlineSegment[] = []
  let cursor = 0
  let textStart = 0

  while (cursor < text.length) {
    const markdownFileLink = parseMarkdownFileLinkAt(text, cursor)
    if (markdownFileLink) {
      if (cursor > textStart) {
        segments.push({ kind: 'text', value: text.slice(textStart, cursor) })
      }
      segments.push(markdownFileLink.segment)
      cursor = markdownFileLink.end
      textStart = cursor
      continue
    }

    const boldSegment = parseBoldAt(text, cursor)
    if (boldSegment) {
      if (cursor > textStart) {
        segments.push({ kind: 'text', value: text.slice(textStart, cursor) })
      }
      segments.push(boldSegment.segment)
      cursor = boldSegment.end
      textStart = cursor
      continue
    }

    if (text[cursor] !== '`') {
      cursor += 1
      continue
    }

    let openLength = 1
    while (cursor + openLength < text.length && text[cursor + openLength] === '`') {
      openLength += 1
    }
    const delimiter = '`'.repeat(openLength)

    let searchFrom = cursor + openLength
    let closingStart = -1
    while (searchFrom < text.length) {
      const candidate = text.indexOf(delimiter, searchFrom)
      if (candidate < 0) break

      const hasBacktickBefore = candidate > 0 && text[candidate - 1] === '`'
      const hasBacktickAfter =
        candidate + openLength < text.length && text[candidate + openLength] === '`'
      const hasNewLineInside = text.slice(cursor + openLength, candidate).includes('\n')

      if (!hasBacktickBefore && !hasBacktickAfter && !hasNewLineInside) {
        closingStart = candidate
        break
      }
      searchFrom = candidate + 1
    }

    if (closingStart < 0) {
      cursor += openLength
      continue
    }

    if (cursor > textStart) {
      segments.push({ kind: 'text', value: text.slice(textStart, cursor) })
    }

    const token = text.slice(cursor + openLength, closingStart)
    if (token.length > 0) {
      const fileSegment = createFileSegment(token)
      if (fileSegment) {
        segments.push(fileSegment)
      } else {
        segments.push({ kind: 'code', value: token })
      }
    } else {
      segments.push({ kind: 'text', value: `${delimiter}${delimiter}` })
    }

    cursor = closingStart + openLength
    textStart = cursor
  }

  if (textStart < text.length) {
    segments.push({ kind: 'text', value: text.slice(textStart) })
  }

  return segments
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function formatIsoTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString()
}

function readRequestReason(request: UiServerRequest): string {
  const params = asRecord(request.params)
  const reason = params?.reason
  return typeof reason === 'string' ? reason.trim() : ''
}

function parseBangHeader(text: string): string {
  const [firstLine] = text.split('\n')
  const header = firstLine?.trim()
  return header && header.length > 0 ? header : '• You ran command'
}

function parseBangOutput(text: string): string {
  const idx = text.indexOf('\n')
  if (idx < 0) return ''
  return text.slice(idx + 1)
}

function isCopied(blockId: string): boolean {
  return copiedBlockId.value === blockId
}

function fallbackCopyToClipboard(text: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

async function copyText(blockId: string, text: string): Promise<void> {
  const value = text ?? ''
  if (!value) return
  let copied = false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      copied = true
    } else {
      copied = fallbackCopyToClipboard(value)
    }
  } catch {
    copied = fallbackCopyToClipboard(value)
  }
  if (copied) {
    copiedBlockId.value = blockId
    if (copiedBlockResetTimer !== null) {
      window.clearTimeout(copiedBlockResetTimer)
    }
    copiedBlockResetTimer = window.setTimeout(() => {
      copiedBlockResetTimer = null
      copiedBlockId.value = ''
    }, 1200)
  }
}

function toolQuestionKey(requestId: UiServerRequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}`
}

function readToolQuestions(request: UiServerRequest): ParsedToolQuestion[] {
  const params = asRecord(request.params)
  const questions = Array.isArray(params?.questions) ? params.questions : []
  const parsed: ParsedToolQuestion[] = []

  for (const row of questions) {
    const question = asRecord(row)
    if (!question) continue
    const id = typeof question.id === 'string' ? question.id : ''
    if (!id) continue

    const options = Array.isArray(question.options)
      ? question.options
        .map((option) => asRecord(option))
        .map((option) => option?.label)
        .filter((option): option is string => typeof option === 'string' && option.length > 0)
      : []

    parsed.push({
      id,
      header: typeof question.header === 'string' ? question.header : '',
      question: typeof question.question === 'string' ? question.question : '',
      isOther: question.isOther === true,
      options,
    })
  }

  return parsed
}

function readQuestionAnswer(requestId: UiServerRequestId, questionId: string, fallback: string): string {
  const key = toolQuestionKey(requestId, questionId)
  const saved = toolQuestionAnswers.value[key]
  if (typeof saved === 'string' && saved.length > 0) return saved
  return fallback
}

function readQuestionOtherAnswer(requestId: UiServerRequestId, questionId: string): string {
  const key = toolQuestionKey(requestId, questionId)
  return toolQuestionOtherAnswers.value[key] ?? ''
}

function onQuestionAnswerChange(requestId: UiServerRequestId, questionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const key = toolQuestionKey(requestId, questionId)
  toolQuestionAnswers.value = {
    ...toolQuestionAnswers.value,
    [key]: target.value,
  }
}

function onQuestionOtherAnswerInput(requestId: UiServerRequestId, questionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const key = toolQuestionKey(requestId, questionId)
  toolQuestionOtherAnswers.value = {
    ...toolQuestionOtherAnswers.value,
    [key]: target.value,
  }
}

function onRespondApproval(requestId: UiServerRequestId, decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel'): void {
  emit('respondServerRequest', {
    id: requestId,
    result: { decision },
  })
}

function onRespondToolRequestUserInput(request: UiServerRequest): void {
  const questions = readToolQuestions(request)
  const answers: Record<string, { answers: string[] }> = {}

  for (const question of questions) {
    const selected = readQuestionAnswer(request.id, question.id, question.options[0] || '')
    const other = readQuestionOtherAnswer(request.id, question.id).trim()
    const values = [selected, other].map((value) => value.trim()).filter((value) => value.length > 0)
    answers[question.id] = { answers: values }
  }

  emit('respondServerRequest', {
    id: request.id,
    result: { answers },
  })
}

function onRespondToolCallFailure(requestId: UiServerRequestId): void {
  emit('respondServerRequest', {
    id: requestId,
    result: {
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text: 'Tool call rejected from codex-web-local UI.',
        },
      ],
    },
  })
}

function onRespondToolCallSuccess(requestId: UiServerRequestId): void {
  emit('respondServerRequest', {
    id: requestId,
    result: {
      success: true,
      contentItems: [],
    },
  })
}

function onRespondEmptyResult(requestId: UiServerRequestId): void {
  emit('respondServerRequest', {
    id: requestId,
    result: {},
  })
}

function onRejectUnknownRequest(requestId: UiServerRequestId): void {
  emit('respondServerRequest', {
    id: requestId,
    error: {
      code: -32000,
      message: 'Rejected from codex-web-local UI.',
    },
  })
}

function scrollToBottom(): void {
  const container = conversationListRef.value
  const anchor = bottomAnchorRef.value
  if (!container || !anchor) return
  container.scrollTop = container.scrollHeight
  anchor.scrollIntoView({ block: 'end' })
}

function isAtBottom(container: HTMLElement): boolean {
  const distance = container.scrollHeight - (container.scrollTop + container.clientHeight)
  return distance <= BOTTOM_THRESHOLD_PX
}

function emitScrollState(container: HTMLElement, options: { force?: boolean } = {}): void {
  if (isRestoringScrollState && options.force !== true) return
  if (!props.activeThreadId) return
  const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
  const scrollRatio = maxScrollTop > 0 ? Math.min(Math.max(container.scrollTop / maxScrollTop, 0), 1) : 1
  emit('updateScrollState', {
    threadId: props.activeThreadId,
    state: {
      scrollTop: container.scrollTop,
      isAtBottom: isAtBottom(container) || scrollRatio >= NEAR_BOTTOM_SCROLL_RATIO,
      scrollRatio,
    },
  })
}

function shouldTreatSavedStateAsBottom(savedState: ThreadScrollState | null): boolean {
  return !savedState ||
    savedState.isAtBottom === true ||
    (
      typeof savedState.scrollRatio === 'number' &&
      savedState.scrollRatio >= NEAR_BOTTOM_SCROLL_RATIO
    )
}

function withScrollRestoreGuard(callback: () => void): void {
  if (scrollRestoreGuardFrame) {
    cancelAnimationFrame(scrollRestoreGuardFrame)
    scrollRestoreGuardFrame = 0
  }
  isRestoringScrollState = true
  try {
    callback()
  } finally {
    scrollRestoreGuardFrame = requestAnimationFrame(() => {
      scrollRestoreGuardFrame = 0
      isRestoringScrollState = false
    })
  }
}

function scheduleUserScrollStateSync(): void {
  if (userScrollStateFrame) {
    cancelAnimationFrame(userScrollStateFrame)
  }
  userScrollStateFrame = requestAnimationFrame(() => {
    userScrollStateFrame = 0
    const container = conversationListRef.value
    if (!container || props.isLoading) return
    emitScrollState(container)
  })
}

function applySavedScrollState(): void {
  const container = conversationListRef.value
  if (!container) return

  const savedState = props.scrollState
  if (shouldTreatSavedStateAsBottom(savedState)) {
    withScrollRestoreGuard(() => {
      enforceBottomState({ forceEmit: true })
    })
    return
  }
  if (!savedState) return

  withScrollRestoreGuard(() => {
    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
    const targetScrollTop =
      typeof savedState.scrollRatio === 'number'
        ? savedState.scrollRatio * maxScrollTop
        : savedState.scrollTop
    container.scrollTop = Math.min(Math.max(targetScrollTop, 0), maxScrollTop)
  })
}

function enforceBottomState(options: { forceEmit?: boolean } = {}): void {
  const container = conversationListRef.value
  if (!container) return
  scrollToBottom()
  emitScrollState(container, { force: options.forceEmit })
}

function shouldLockToBottom(): boolean {
  return shouldTreatSavedStateAsBottom(props.scrollState)
}

function runBottomLockFrame(): void {
  if (!shouldLockToBottom()) {
    bottomLockFramesLeft = 0
    bottomLockFrame = 0
    return
  }

  enforceBottomState()
  bottomLockFramesLeft -= 1
  if (bottomLockFramesLeft <= 0) {
    bottomLockFrame = 0
    return
  }
  bottomLockFrame = requestAnimationFrame(runBottomLockFrame)
}

function scheduleBottomLock(frames = 6): void {
  if (!shouldLockToBottom()) return
  if (bottomLockFrame) {
    cancelAnimationFrame(bottomLockFrame)
    bottomLockFrame = 0
  }
  bottomLockFramesLeft = Math.max(frames, 1)
  bottomLockFrame = requestAnimationFrame(runBottomLockFrame)
}

function onPendingImageSettled(): void {
  scheduleBottomLock(3)
}

function bindPendingImageHandlers(): void {
  if (!shouldLockToBottom()) return
  const container = conversationListRef.value
  if (!container) return

  const images = container.querySelectorAll<HTMLImageElement>('img.message-image-preview')
  for (const image of images) {
    if (image.complete || trackedPendingImages.has(image)) continue
    trackedPendingImages.add(image)
    image.addEventListener('load', onPendingImageSettled, { once: true })
    image.addEventListener('error', onPendingImageSettled, { once: true })
  }
}

async function scheduleScrollRestore(): Promise<void> {
  await nextTick()
  if (scrollRestoreFrame) {
    cancelAnimationFrame(scrollRestoreFrame)
  }
  scrollRestoreFrame = requestAnimationFrame(() => {
    scrollRestoreFrame = 0
    applySavedScrollState()
    bindPendingImageHandlers()
    scheduleBottomLock()
  })
}

watch(
  () => props.messages,
  async () => {
    if (props.isLoading) return
    await scheduleScrollRestore()
  },
)

watch(
  () => props.liveOverlay,
  async (overlay) => {
    if (!overlay) return
    await nextTick()
    enforceBottomState()
    scheduleBottomLock(8)
  },
  { deep: true },
)

watch(
  () => props.isLoading,
  async (loading) => {
    if (loading) return
    await scheduleScrollRestore()
  },
)

watch(
  () => props.activeThreadId,
  async () => {
    modalImageUrl.value = ''
    if (props.isLoading) return
    await scheduleScrollRestore()
  },
  { flush: 'post' },
)

onMounted(() => {
  if (!props.isLoading) {
    void scheduleScrollRestore()
  }
})

function onConversationScroll(): void {
  const container = conversationListRef.value
  if (!container || props.isLoading) return
  emitScrollState(container)
}

function openImageModal(imageUrl: string): void {
  modalImageUrl.value = imageUrl
}

function closeImageModal(): void {
  modalImageUrl.value = ''
}

onBeforeUnmount(() => {
  if (scrollRestoreFrame) {
    cancelAnimationFrame(scrollRestoreFrame)
  }
  if (scrollRestoreGuardFrame) {
    cancelAnimationFrame(scrollRestoreGuardFrame)
  }
  if (userScrollStateFrame) {
    cancelAnimationFrame(userScrollStateFrame)
  }
  if (bottomLockFrame) {
    cancelAnimationFrame(bottomLockFrame)
  }
  if (copiedBlockResetTimer !== null) {
    clearTimeout(copiedBlockResetTimer)
    copiedBlockResetTimer = null
  }
})
</script>

<style scoped>
@reference "tailwindcss";

.conversation-root {
  @apply h-full min-h-0 min-w-0 p-0 flex flex-col overflow-y-hidden overflow-x-hidden bg-transparent border-none rounded-none;
}

.conversation-loading {
  @apply m-0 px-6 text-sm text-slate-500;
}

.conversation-empty {
  @apply m-0 px-6 text-sm text-slate-500;
}

.conversation-list {
  @apply h-full min-h-0 min-w-0 list-none m-0 px-6 py-0 overflow-y-auto overflow-x-hidden flex flex-col gap-3;
}

.conversation-item {
  @apply m-0 w-full min-w-0 flex;
}

.conversation-item-request {
  @apply justify-center;
}

.conversation-item-overlay {
  @apply justify-center;
}

.message-row {
  @apply relative w-full min-w-0 max-w-180 mx-auto flex;
}

.message-row[data-role='user'] {
  @apply justify-end;
}

.message-row[data-role='assistant'],
.message-row[data-role='system'] {
  @apply justify-start;
}

.conversation-bottom-anchor {
  @apply h-px;
}

.message-stack {
  @apply flex flex-col w-full min-w-0;
}

.request-card {
  @apply w-full max-w-180 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col gap-2;
}

.request-title {
  @apply m-0 text-sm leading-5 font-semibold text-amber-900;
}

.request-meta {
  @apply m-0 text-xs leading-4 text-amber-700;
}

.request-reason {
  @apply m-0 text-sm leading-5 text-amber-900 whitespace-pre-wrap;
}

.request-actions {
  @apply flex flex-wrap gap-2;
}

.request-button {
  @apply rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-900 hover:bg-amber-100 transition;
}

.request-button-primary {
  @apply border-amber-500 bg-amber-500 text-white hover:bg-amber-600;
}

.request-user-input {
  @apply flex flex-col gap-3;
}

.request-question {
  @apply flex flex-col gap-1;
}

.request-question-title {
  @apply m-0 text-sm leading-5 font-medium text-amber-900;
}

.request-question-text {
  @apply m-0 text-xs leading-4 text-amber-800;
}

.request-select {
  @apply h-8 rounded-md border border-amber-300 bg-white px-2 text-sm text-amber-900;
}

.request-input {
  @apply h-8 rounded-md border border-amber-300 bg-white px-2 text-sm text-amber-900 placeholder:text-amber-500;
}

.live-overlay-inline {
  @apply w-full max-w-180 px-0 py-1 flex flex-col gap-1;
}

.live-overlay-label {
  @apply m-0 text-sm leading-5 font-medium text-zinc-600;
}

.live-overlay-reasoning {
  @apply m-0 text-sm leading-5 text-zinc-500 whitespace-pre-wrap;
}

.live-overlay-error {
  @apply m-0 text-sm leading-5 text-rose-600 whitespace-pre-wrap;
}

.message-body {
  @apply flex flex-col max-w-full min-w-0;
  width: fit-content;
}

.message-body[data-role='user'] {
  @apply ml-auto items-end;
  align-self: flex-end;
}

.message-image-list {
  @apply list-none m-0 mb-2 p-0 flex flex-wrap gap-2;
}

.message-image-list[data-role='user'] {
  @apply ml-auto justify-end;
}

.message-image-item {
  @apply m-0;
}

.message-image-button {
  @apply block rounded-xl overflow-hidden border border-slate-300 bg-white p-0 transition hover:border-slate-400;
}

.message-image-preview {
  @apply block w-16 h-16 object-cover;
}

.message-card {
  @apply max-w-[min(76ch,100%)] px-0 py-0 bg-transparent border-none rounded-none;
}

.message-text {
  @apply m-0 text-sm leading-relaxed whitespace-pre-wrap break-words text-slate-800;
  overflow-wrap: anywhere;
}

.message-code-block {
  /* Reserve space for the top-right Copy control so short one-line snippets are not covered */
  @apply my-2 w-full min-w-0 max-w-full min-w-[min(100%,13rem)] overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-[3.75rem];
}

.message-code-block-wrap {
  @apply relative block w-full min-w-0 max-w-full min-w-[min(100%,13rem)];
}

.message-code-block-inner {
  @apply m-0 block font-mono text-[0.8125rem] leading-relaxed text-slate-900 whitespace-pre-wrap;
  overflow-wrap: anywhere;
}

.message-code-copy {
  @apply absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 opacity-65;
}

.message-code-copy-icon {
  @apply h-4 w-4 shrink-0;
}

.message-code-block-wrap:hover .message-code-copy,
.message-bang-output-wrap:hover .message-code-copy {
  @apply opacity-100;
}

.message-slasht-status {
  @apply my-2 w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5;
  @apply m-0 font-mono text-[0.75rem] leading-snug text-slate-900 whitespace-pre-wrap;
}

.message-bang-card {
  @apply my-2 w-full min-w-0 max-w-full;
}

.message-bang-header {
  @apply m-0 mb-1 font-mono text-[0.75rem] leading-snug text-slate-800 whitespace-pre-wrap;
}

.message-bang-output {
  @apply m-0 w-full min-w-0 max-w-full min-w-[min(100%,13rem)] overflow-x-auto overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-3 pr-[3.75rem];
  @apply m-0 font-mono text-[0.75rem] text-slate-900 whitespace-pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.25rem;
  max-height: calc(1.25rem * 24 + 1.25rem);
}

.message-bang-output-wrap {
  @apply relative block w-full min-w-0 max-w-full min-w-[min(100%,13rem)];
}

.message-card[data-role='user'] .message-code-block {
  @apply max-w-[min(560px,100%)];
}

.message-inline-code {
  @apply rounded-md border border-slate-200 bg-slate-100/60 px-1.5 py-0.5 text-[0.875em] leading-[1.4] text-slate-900 font-mono;
}

.message-bold {
  @apply font-semibold;
}

.message-file-link {
  @apply text-sm leading-relaxed text-[#0969da] no-underline hover:text-[#1f6feb] hover:underline underline-offset-2;
}

.message-stack[data-role='user'] {
  @apply items-end;
}

.message-stack[data-role='assistant'],
.message-stack[data-role='system'] {
  @apply items-start;
}

.message-card[data-role='user'] {
  @apply rounded-2xl bg-slate-200 px-4 py-3 max-w-[min(560px,100%)];
  width: fit-content;
  margin-left: auto;
  align-self: flex-end;
}

.message-card[data-role='assistant'],
.message-card[data-role='system'] {
  @apply px-0 py-0 bg-transparent border-none rounded-none;
}

.conversation-item[data-message-type='worked'] .message-stack,
.conversation-item[data-message-type='worked'] .message-body,
.conversation-item[data-message-type='worked'] .message-card {
  @apply w-full max-w-full;
}

.worked-separator {
  @apply w-full flex items-center gap-4;
}

.worked-separator-line {
  @apply h-px bg-zinc-300/80 flex-1;
}

.worked-separator-text {
  @apply m-0 text-sm leading-relaxed font-normal text-slate-800;
}

.image-modal-backdrop {
  @apply fixed inset-0 z-50 bg-black/40 p-6 flex items-center justify-center;
}

.image-modal-content {
  @apply relative max-w-[min(92vw,1100px)] max-h-[92vh];
}

.image-modal-close {
  @apply absolute top-2 right-2 z-10 w-10 h-10 rounded-full bg-white/90 text-slate-900 border border-slate-300 flex items-center justify-center;
}

.image-modal-image {
  @apply block max-w-full max-h-[90vh] rounded-2xl shadow-2xl bg-white;
}

.icon-svg {
  @apply w-5 h-5;
}
</style>
