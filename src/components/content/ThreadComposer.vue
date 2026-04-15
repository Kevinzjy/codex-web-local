<template>
  <form class="thread-composer" @submit.prevent="onSubmit">
    <div class="thread-composer-shell">
      <ul v-if="images.length > 0" class="thread-composer-image-list" aria-label="Attached images">
        <li v-for="image in images" :key="image.id" class="thread-composer-image-item">
          <img class="thread-composer-image-preview" :src="image.url" :alt="image.name" />
          <button
            class="thread-composer-image-remove"
            type="button"
            :aria-label="`Remove ${image.name}`"
            @click="removeImage(image.id)"
          >
            x
          </button>
        </li>
      </ul>

      <div class="thread-composer-message-row">
        <textarea
          id="thread-composer-message"
          ref="messageInputRef"
          v-model="draft"
          class="thread-composer-input"
          name="message"
          rows="1"
          :placeholder="placeholderText"
          :disabled="disabled || !activeThreadId || isTurnInProgress"
          :readonly="isSpeechListening"
          autocomplete="off"
          @input="onDraftInput"
          @click="refreshTriggerSuggestions"
          @keyup="onDraftCursorMove"
          @keydown="onInputKeydown"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @paste="onPaste"
        />
        <div
          v-if="triggerMenuOpen && triggerSuggestions.length > 0"
          class="thread-composer-trigger-menu"
          :class="{ 'thread-composer-trigger-menu--flip-up': triggerMenuFlipUp }"
          role="listbox"
          :aria-label="`Suggestions for ${triggerChar || 'trigger'}`"
        >
          <button
            v-for="(item, index) in triggerSuggestions"
            :key="item.id"
            class="thread-composer-trigger-item"
            :class="{ 'thread-composer-trigger-item--active': index === triggerActiveIndex }"
            type="button"
            role="option"
            :aria-selected="index === triggerActiveIndex"
            @mousedown.prevent
            @click="applyTriggerSuggestion(index)"
          >
            <span class="thread-composer-trigger-item-label">{{ item.label }}</span>
            <span v-if="item.description" class="thread-composer-trigger-item-desc">{{ item.description }}</span>
          </button>
        </div>
      </div>

      <p
        v-if="speechStatusVisible"
        class="thread-composer-speech-status"
        role="status"
        aria-live="polite"
      >
        <template v-if="isSpeechStarting">Requesting microphone… Allow access if the browser asks.</template>
        <template v-else>Listening — speak now. Tap the mic again to stop.</template>
      </p>

      <p v-if="imageError" class="thread-composer-image-error" role="status">{{ imageError }}</p>
      <p v-if="speechError" class="thread-composer-speech-error" role="status">{{ speechError }}</p>

      <input
        id="thread-composer-image-files"
        ref="imageInputRef"
        class="thread-composer-file-input"
        type="file"
        name="images"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        @change="onImageInputChange"
      />

      <!-- Left: model / thinking / context — Right: attach / mic / send; space-between when wide -->
      <div class="thread-composer-footer">
        <div class="thread-composer-footer-controls">
          <ComposerDropdown
            class="thread-composer-control"
            :model-value="selectedModel"
            :options="modelOptions"
            placeholder="Model"
            open-direction="up"
            trigger-title="Choose model"
            :disabled="disabled || !activeThreadId || models.length === 0 || isTurnInProgress"
            @update:model-value="onModelSelect"
          />

          <ComposerDropdown
            class="thread-composer-control"
            :model-value="selectedReasoningEffort"
            :options="reasoningOptions"
            placeholder="Thinking"
            open-direction="up"
            trigger-title="Select reasoning effort"
            :disabled="disabled || !activeThreadId || isTurnInProgress"
            @update:model-value="onReasoningEffortSelect"
          />

          <span
            class="thread-composer-context-usage"
            :data-level="contextUsageLevel"
            :aria-label="contextUsageAriaLabel"
            :title="contextUsageTitle"
          >
            <svg
              class="thread-composer-context-ring"
              viewBox="0 0 36 36"
              aria-hidden="true"
              focusable="false"
            >
              <circle
                class="thread-composer-context-ring-track"
                cx="18"
                cy="18"
                :r="CONTEXT_RING_RADIUS"
                fill="none"
                stroke-width="3.5"
              />
              <circle
                class="thread-composer-context-ring-fill"
                cx="18"
                cy="18"
                :r="CONTEXT_RING_RADIUS"
                fill="none"
                stroke-width="3.5"
                stroke-linecap="round"
                :stroke-dasharray="contextRingCircumferenceStr"
                :stroke-dashoffset="contextRingDashOffset"
                transform="rotate(-90 18 18)"
              />
            </svg>
          </span>
        </div>

        <div class="thread-composer-actions-rail" aria-label="Attachments and send">
          <button
            class="thread-composer-add-files"
            type="button"
            aria-label="Add images"
            title="Add images"
            :disabled="!canEdit"
            @click="openImageFilePicker"
          >
            <IconTablerPhoto class="thread-composer-add-files-icon" />
          </button>

          <button
            class="thread-composer-mic"
            type="button"
            :class="{
              'thread-composer-mic--listening': isSpeechListening,
              'thread-composer-mic--starting': isSpeechStarting,
            }"
            :aria-pressed="isSpeechListening"
            :aria-label="speechButtonLabel"
            :title="speechButtonTitle"
            :disabled="!canUseSpeech"
            @click="onSpeechToggle"
          >
            <IconTablerMicrophone class="thread-composer-mic-icon" />
          </button>

          <button
            v-if="isTurnInProgress"
            class="thread-composer-stop"
            type="button"
            aria-label="Стоп"
            :disabled="disabled || !activeThreadId || isInterruptingTurn"
            @click="onInterrupt"
          >
            <IconTablerPlayerStopFilled class="thread-composer-stop-icon" />
          </button>
          <button
            v-else
            class="thread-composer-submit"
            type="submit"
            aria-label="Send message"
            :disabled="!canSubmit"
          >
            <IconTablerArrowUp class="thread-composer-submit-icon" />
          </button>
        </div>
      </div>
    </div>

    <!-- Worktree + permission: outside the input card, same row (left / right) -->
    <div v-if="showComposerBottomBar" class="thread-composer-bottom-bar">
      <div class="thread-composer-permission-outside">
        <div class="thread-composer-permission-outside-left">
          <button
            v-if="threadCwd.trim().length > 0"
            class="thread-composer-new-worktree"
            type="button"
            title="Select where to run the task"
            :disabled="disabled || !activeThreadId || isTurnInProgress || worktreeCreating"
            :aria-busy="worktreeCreating"
            @click="worktreeModalOpen = true"
          >
            <IconTablerGitBranch class="thread-composer-new-worktree-icon" />
            <span>{{ worktreeCreating ? 'Creating…' : 'New worktree' }}</span>
          </button>
        </div>
        <ComposerDropdown
          v-if="showPermissionMode"
          class="thread-composer-control thread-composer-permission thread-composer-permission-outside-dropdown"
          :model-value="permissionMode"
          :options="permissionOptions"
          placeholder="Permissions"
          open-direction="up"
          menu-align="end"
          trigger-title="Change permissions"
          :disabled="disabled || !activeThreadId || isTurnInProgress"
          @update:model-value="onPermissionModeSelect"
        />
      </div>
      <p v-if="worktreeStatusText" class="thread-composer-worktree-status" role="status">{{ worktreeStatusText }}</p>
    </div>
  </form>

  <GitWorktreeModal
    :open="worktreeModalOpen"
    :theme="theme"
    :can-fork="worktreeCanFork"
    :busy="worktreeCreating"
    @close="worktreeModalOpen = false"
    @confirm="onConfirmGitWorktree"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ReasoningEffort, ThreadPermissionMode, UiComposerDraft, UiComposerImage } from '../../types/codex'
import type { FsEntryKind } from '../../types/fsDirectories'
import { fetchComposerSlashSuggestions } from '../../api/composerSlashClient'
import { fetchFsComplete } from '../../api/fsDirectoriesClient'
import { useWebSpeechRecognition } from '../../composables/useWebSpeechRecognition'
import { createGitWorktree } from '../../api/codexRpcClient'
import { CodexApiError } from '../../api/codexErrors'
import { isCoarsePointer, isLikelyIOS } from '../../utils/platform'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerPlayerStopFilled from '../icons/IconTablerPlayerStopFilled.vue'
import IconTablerMicrophone from '../icons/IconTablerMicrophone.vue'
import IconTablerPhoto from '../icons/IconTablerPhoto.vue'
import IconTablerGitBranch from '../icons/IconTablerGitBranch.vue'
import ComposerDropdown from './ComposerDropdown.vue'
import GitWorktreeModal, { type GitWorktreeFollowUp } from './GitWorktreeModal.vue'

const MAX_IMAGE_COUNT = 8
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const props = withDefaults(
  defineProps<{
    activeThreadId: string
    /** Current thread or new-chat project directory; used for New worktree */
    threadCwd?: string
    models: string[]
    selectedModel: string
    selectedReasoningEffort: ReasoningEffort | ''
    permissionMode?: ThreadPermissionMode
    showPermissionMode?: boolean
    contextUsagePercent?: number | null
    isTurnInProgress?: boolean
    isInterruptingTurn?: boolean
    disabled?: boolean
    theme?: 'dark' | 'light'
    /** When true, worktree dialog can offer “fork current thread” (e.g. thread view, not home). */
    worktreeCanFork?: boolean
  }>(),
  {
    threadCwd: '',
    permissionMode: 'default',
    showPermissionMode: false,
    theme: 'light',
    worktreeCanFork: false,
  },
)

const emit = defineEmits<{
  submit: [draft: UiComposerDraft]
  interrupt: []
  'update:selected-model': [modelId: string]
  'update:selected-reasoning-effort': [effort: ReasoningEffort | '']
  'update:permission-mode': [mode: ThreadPermissionMode]
  'worktree-created': [payload: { worktreePath: string; branch: string; followUp: GitWorktreeFollowUp }]
}>()

const draft = ref('')
const images = ref<UiComposerImage[]>([])
const imageError = ref('')
const imageInputRef = ref<HTMLInputElement | null>(null)
const messageInputRef = ref<HTMLTextAreaElement | null>(null)
type TriggerSuggestion = {
  id: string
  label: string
  insertText: string
  description?: string
  /** True when the fs entry is a directory (@ completion can drill into children). */
  isDirectory?: boolean
}

const triggerMenuOpen = ref(false)
const triggerSuggestions = ref<TriggerSuggestion[]>([])
const triggerActiveIndex = ref(0)
const triggerChar = ref<'/' | '@' | ''>('')
const triggerTokenRange = ref<{ start: number; end: number } | null>(null)
const atCompleteRequestId = ref(0)
/** Open the trigger menu upward when there is little space below the input (viewport clipping). */
const triggerMenuFlipUp = ref(false)
let atDebounceTimer: number | null = null
const slashAllSuggestions = ref<TriggerSuggestion[] | null>(null)
const slashCacheCwd = ref('')
let slashCacheLoadId = 0

/** Matches Tailwind max-h-40 (10rem) — keep in sync with .thread-composer-input */
const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 160
const isComposingText = ref(false)
const justEndedComposition = ref(false)
const reasoningOptions: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
]
const modelOptions = computed(() =>
  props.models.map((modelId) => ({ value: modelId, label: modelId })),
)

const permissionOptions: Array<{
  value: ThreadPermissionMode
  label: string
  triggerLabel: string
  decoration: 'permission-default' | 'permission-full'
}> = [
  {
    value: 'default',
    label: 'Default permissions',
    triggerLabel: 'Default',
    decoration: 'permission-default',
  },
  {
    value: 'full-access',
    label: 'Full access',
    triggerLabel: 'Full access',
    decoration: 'permission-full',
  },
]

const showComposerBottomBar = computed(
  () => props.showPermissionMode || props.threadCwd.trim().length > 0,
)

const worktreeModalOpen = ref(false)
const worktreeCreating = ref(false)
const worktreeStatusText = ref('')
let worktreeStatusClearTimer: ReturnType<typeof setTimeout> | null = null

function clearWorktreeStatusTimer(): void {
  if (worktreeStatusClearTimer !== null) {
    clearTimeout(worktreeStatusClearTimer)
    worktreeStatusClearTimer = null
  }
}

async function onConfirmGitWorktree(payload: {
  path: string
  branch: string
  followUp: GitWorktreeFollowUp
}): Promise<void> {
  const cwd = props.threadCwd.trim()
  if (!cwd || worktreeCreating.value) return
  clearWorktreeStatusTimer()
  worktreeCreating.value = true
  worktreeStatusText.value = ''
  try {
    const r = await createGitWorktree(cwd, payload.path, payload.branch)
    worktreeModalOpen.value = false
    worktreeStatusText.value = ''
    emit('worktree-created', {
      worktreePath: r.worktreePath,
      branch: r.branch,
      followUp: payload.followUp,
    })
  } catch (err) {
    const msg =
      err instanceof CodexApiError ? err.message : err instanceof Error ? err.message : 'Failed to create worktree'
    worktreeStatusText.value = msg
  } finally {
    worktreeCreating.value = false
  }
}

const canSubmit = computed(() => {
  if (props.disabled) return false
  if (!props.activeThreadId) return false
  if (props.isTurnInProgress) return false
  return draft.value.trim().length > 0 || images.value.length > 0
})

const placeholderText = computed(() =>
  props.activeThreadId ? 'Type a message...' : 'Select a thread to send a message',
)

const canEdit = computed(() => !props.disabled && props.activeThreadId.length > 0 && !props.isTurnInProgress)

const speech = useWebSpeechRecognition()
const isSpeechListening = speech.isListening
const isSpeechStarting = speech.isStarting
const speechError = speech.errorMessage
const canUseSpeech = computed(() => canEdit.value && speech.isSupported)
const speechStatusVisible = computed(() => isSpeechStarting.value || isSpeechListening.value)
const speechButtonLabel = computed(() => {
  if (!canEdit.value) return 'Voice input'
  if (!speech.isSupported) {
    if (isCoarsePointer()) return 'Voice input'
    return isLikelyIOS() ? 'Voice unavailable on iOS' : 'Voice input unavailable'
  }
  if (isSpeechStarting.value) return 'Cancel microphone setup'
  if (isSpeechListening.value) return 'Stop voice input'
  return 'Voice input'
})
const speechButtonTitle = computed(() => {
  if (!canEdit.value) return 'Select a thread to use voice input'
  if (!speech.isSupported) {
    if (isCoarsePointer()) return ''
    return isLikelyIOS()
      ? 'Web Speech API is not available on iOS (WebKit). Use the keyboard or a desktop browser.'
      : 'Voice input is not supported in this browser.'
  }
  if (isSpeechStarting.value) return 'Tap to cancel while the microphone prompt is open'
  if (isSpeechListening.value) return 'Stop dictation'
  return 'Start dictation (browser speech recognition)'
})
/** SVG ring math (viewBox 36×36, r = 14) */
const CONTEXT_RING_RADIUS = 14
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS
const contextRingCircumferenceStr = String(CONTEXT_RING_CIRCUMFERENCE)

const contextUsagePercentKnown = computed(() => {
  const percent = props.contextUsagePercent
  return typeof percent === 'number' && Number.isFinite(percent)
})

/** 0–100 for the ring; unknown host values render as 0% fill. */
const contextUsagePercentDisplayed = computed(() => {
  const percent = props.contextUsagePercent
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 0
  return Math.round(Math.min(100, Math.max(0, percent)))
})

const contextRingDashOffset = computed(() => {
  const p = contextUsagePercentDisplayed.value
  return CONTEXT_RING_CIRCUMFERENCE * (1 - p / 100)
})

const contextUsageAriaLabel = computed(() => {
  if (!contextUsagePercentKnown.value) {
    return 'Context usage unknown; ring shows 0%'
  }
  return `${contextUsagePercentDisplayed.value}% of context window used`
})

const contextUsageTitle = computed(() => {
  if (!contextUsagePercentKnown.value) {
    return 'Context usage unknown (showing 0%)'
  }
  return `Context usage: ${contextUsagePercentDisplayed.value}%`
})

const contextUsageLevel = computed(() => {
  const percent = props.contextUsagePercent
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 'normal'
  if (percent >= 95) return 'danger'
  if (percent >= 80) return 'warning'
  return 'normal'
})

type TriggerContext = {
  char: '/' | '@'
  query: string
  start: number
  end: number
}

function clearAtDebounce(): void {
  if (atDebounceTimer !== null) {
    clearTimeout(atDebounceTimer)
    atDebounceTimer = null
  }
}

function filterSlashByQuery(entries: TriggerSuggestion[], query: string): TriggerSuggestion[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return entries
  }
  return entries.filter((row) => {
    const desc = row.description?.toLowerCase() ?? ''
    return (
      row.label.toLowerCase().includes(q) ||
      row.id.toLowerCase().includes(q) ||
      (desc.length > 0 && desc.includes(q))
    )
  })
}

async function ensureSlashSuggestionCache(): Promise<void> {
  const cwd = props.threadCwd.trim()
  if (slashCacheCwd.value === cwd && slashAllSuggestions.value !== null) {
    return
  }
  const myId = ++slashCacheLoadId
  const res = await fetchComposerSlashSuggestions(cwd, '')
  if (myId !== slashCacheLoadId) {
    return
  }
  slashCacheCwd.value = cwd
  slashAllSuggestions.value = res.entries.map((e) => ({
    id: e.id,
    label: e.label,
    insertText: e.insertText,
    description: e.description,
  }))
}

watch(
  () => props.threadCwd,
  () => {
    slashAllSuggestions.value = null
    slashCacheCwd.value = ''
    slashCacheLoadId += 1
    void ensureSlashSuggestionCache()
  },
  { immediate: true },
)

function closeTriggerMenu(): void {
  clearAtDebounce()
  atCompleteRequestId.value += 1
  triggerMenuOpen.value = false
  triggerMenuFlipUp.value = false
  triggerSuggestions.value = []
  triggerActiveIndex.value = 0
  triggerChar.value = ''
  triggerTokenRange.value = null
}

/** ~max-h-52 (13rem); keep in sync with `.thread-composer-trigger-menu` max-height */
const TRIGGER_MENU_MAX_HEIGHT_PX = 208

function syncTriggerMenuPlacement(): void {
  const el = messageInputRef.value
  if (!el) {
    triggerMenuFlipUp.value = false
    return
  }
  const rect = el.getBoundingClientRect()
  const margin = 10
  const spaceBelow = window.innerHeight - rect.bottom - margin
  const spaceAbove = rect.top - margin
  triggerMenuFlipUp.value = spaceBelow < TRIGGER_MENU_MAX_HEIGHT_PX && spaceAbove > spaceBelow
}

function onWindowRelayoutForTriggerMenu(): void {
  if (triggerMenuOpen.value) {
    syncTriggerMenuPlacement()
  }
}

watch(
  () => [triggerMenuOpen.value, triggerSuggestions.value.length] as const,
  async ([open]) => {
    if (!open) {
      triggerMenuFlipUp.value = false
      return
    }
    await nextTick()
    syncTriggerMenuPlacement()
  },
  { flush: 'post' },
)

function extractTriggerContext(text: string, caret: number): TriggerContext | null {
  if (caret < 0 || caret > text.length) return null

  let start = caret
  while (start > 0) {
    const previous = text[start - 1]
    if (previous === ' ' || previous === '\n' || previous === '\t') break
    start -= 1
  }

  const token = text.slice(start, caret)
  if (token.length < 1) return null
  const char = token[0]
  if (char !== '/' && char !== '@') return null
  if (start > 0) {
    const previous = text[start - 1]
    if (previous !== ' ' && previous !== '\n' && previous !== '\t') return null
  }

  return {
    char,
    query: token.slice(1),
    start,
    end: caret,
  }
}

function fallbackAtHints(queryRaw: string): TriggerSuggestion[] {
  const cwd = props.threadCwd.trim()
  const base: TriggerSuggestion[] = [
    { id: '@rel', label: '@.', insertText: '@.', description: 'Relative to thread cwd' },
    { id: '@par', label: '@../', insertText: '@../', description: 'Parent of cwd' },
    { id: '@abs', label: '@/', insertText: '@/', description: 'Absolute path on host' },
  ]
  if (cwd) {
    const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`
    base.unshift({
      id: 'cwd-prefix',
      label: `@${prefix}`,
      insertText: `@${prefix}`,
      description: 'Thread working directory',
    })
  }
  const q = queryRaw.trim().toLowerCase()
  if (!q) return base
  return base.filter((row) => row.label.toLowerCase().includes(q))
}

function mentionInsertForEntry(cwdNorm: string, entryPath: string, kind: FsEntryKind): string {
  const cwd = cwdNorm.replace(/\\/gu, '/').replace(/\/+$/gu, '')
  const p = entryPath.replace(/\\/gu, '/')
  let body: string
  if (p.startsWith(`${cwd}/`) || p === cwd) {
    const rest = p === cwd ? '' : p.slice(cwd.length + 1)
    body = rest || '.'
    if (kind === 'directory' && !body.endsWith('/') && body !== '.') {
      body += '/'
    }
  } else {
    body = p
    if (kind === 'directory' && !body.endsWith('/')) {
      body += '/'
    }
  }
  if (kind === 'file') {
    return `@${body} `
  }
  return `@${body}`
}

async function runSlashCompletionAfterCache(context: TriggerContext, requestId: number): Promise<void> {
  try {
    await ensureSlashSuggestionCache()
    if (requestId !== atCompleteRequestId.value) {
      return
    }
    const cwd = props.threadCwd.trim()
    if (slashCacheCwd.value !== cwd || slashAllSuggestions.value === null) {
      closeTriggerMenu()
      return
    }
    const items = filterSlashByQuery(slashAllSuggestions.value, context.query).slice(0, 128)
    if (items.length === 0) {
      closeTriggerMenu()
      return
    }
    triggerSuggestions.value = items
    triggerActiveIndex.value = 0
    triggerMenuOpen.value = true
    triggerChar.value = '/'
    triggerTokenRange.value = { start: context.start, end: context.end }
  } catch {
    if (requestId !== atCompleteRequestId.value) {
      return
    }
    closeTriggerMenu()
  }
}

async function runAtPathCompletion(context: TriggerContext, requestId: number): Promise<void> {
  const cwd = props.threadCwd.trim()
  if (!cwd) {
    return
  }
  try {
    const res = await fetchFsComplete(cwd, context.query)
    if (requestId !== atCompleteRequestId.value) return
    const suggestions: TriggerSuggestion[] = res.entries.map((e) => ({
      id: `fs:${e.path}`,
      label: e.kind === 'directory' ? `${e.name}/` : e.name,
      insertText: mentionInsertForEntry(cwd, e.path, e.kind),
      description: e.path,
      isDirectory: e.kind === 'directory',
    }))
    if (suggestions.length === 0) {
      triggerMenuOpen.value = false
      return
    }
    triggerSuggestions.value = suggestions
    triggerActiveIndex.value = 0
    triggerMenuOpen.value = true
    triggerChar.value = '@'
    triggerTokenRange.value = { start: context.start, end: context.end }
  } catch {
    if (requestId !== atCompleteRequestId.value) return
    const items = fallbackAtHints(context.query)
    triggerSuggestions.value = items
    triggerActiveIndex.value = 0
    triggerMenuOpen.value = items.length > 0
  }
}

function refreshTriggerSuggestions(): void {
  const el = messageInputRef.value
  if (!el || !canEdit.value) {
    closeTriggerMenu()
    return
  }

  const context = extractTriggerContext(draft.value, el.selectionStart ?? draft.value.length)
  if (!context) {
    closeTriggerMenu()
    return
  }

  triggerChar.value = context.char
  triggerTokenRange.value = { start: context.start, end: context.end }

  if (context.char === '/') {
    clearAtDebounce()
    atCompleteRequestId.value += 1
    const requestId = atCompleteRequestId.value
    const cwd = props.threadCwd.trim()
    if (slashCacheCwd.value === cwd && slashAllSuggestions.value !== null) {
      const items = filterSlashByQuery(slashAllSuggestions.value, context.query).slice(0, 128)
      if (items.length === 0) {
        closeTriggerMenu()
        return
      }
      triggerSuggestions.value = items
      triggerActiveIndex.value = 0
      triggerMenuOpen.value = true
      return
    }
    triggerMenuOpen.value = false
    atDebounceTimer = window.setTimeout(() => {
      atDebounceTimer = null
      void runSlashCompletionAfterCache(context, requestId)
    }, 80)
    return
  }

  const cwd = props.threadCwd.trim()
  if (!cwd) {
    atCompleteRequestId.value += 1
    const items = fallbackAtHints(context.query)
    if (items.length === 0) {
      closeTriggerMenu()
      return
    }
    triggerSuggestions.value = items
    triggerActiveIndex.value = 0
    triggerMenuOpen.value = true
    return
  }

  clearAtDebounce()
  atCompleteRequestId.value += 1
  const requestId = atCompleteRequestId.value
  triggerMenuOpen.value = false
  atDebounceTimer = window.setTimeout(() => {
    atDebounceTimer = null
    void runAtPathCompletion(context, requestId)
  }, 120)
}

function applyTriggerSuggestion(index: number): void {
  const el = messageInputRef.value
  const range = triggerTokenRange.value
  const item = triggerSuggestions.value[index]
  if (!el || !range || !item) return

  const before = draft.value.slice(0, range.start)
  const after = draft.value.slice(range.end)
  draft.value = `${before}${item.insertText}${after}`

  const drillIntoDir = triggerChar.value === '@' && item.isDirectory === true
  if (drillIntoDir) {
    clearAtDebounce()
    atCompleteRequestId.value += 1
    triggerSuggestions.value = []
    triggerActiveIndex.value = 0
    triggerMenuOpen.value = true
  } else {
    closeTriggerMenu()
  }

  void nextTick(() => {
    const nextCaret = before.length + item.insertText.length
    el.focus()
    el.setSelectionRange(nextCaret, nextCaret)
    adjustComposerTextareaHeight()
    if (drillIntoDir) {
      refreshTriggerSuggestions()
    }
  })
}

function createImageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Failed to read image from clipboard'))
    })
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Failed to read image from clipboard'))
    })
    reader.readAsDataURL(file)
  })
}

function readImageFilesFromClipboard(event: ClipboardEvent): File[] {
  const clipboardData = event.clipboardData
  if (!clipboardData) return []

  const files: File[] = []
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) {
      files.push(file)
    }
  }

  if (files.length > 0) return files

  return Array.from(clipboardData.files).filter((file) => file.type.startsWith('image/'))
}

async function addImageFiles(files: File[]): Promise<void> {
  imageError.value = ''

  for (const file of files) {
    if (images.value.length >= MAX_IMAGE_COUNT) {
      imageError.value = `You can attach up to ${String(MAX_IMAGE_COUNT)} images.`
      return
    }
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      imageError.value = 'Only PNG, JPEG, WebP, and GIF images are supported.'
      continue
    }
    if (file.size > MAX_IMAGE_BYTES) {
      imageError.value = 'Images must be 10 MB or smaller.'
      continue
    }

    try {
      const url = await readFileAsDataUrl(file)
      images.value = [
        ...images.value,
        {
          id: createImageId(),
          name: file.name || `pasted-image-${String(images.value.length + 1)}`,
          mimeType: file.type,
          size: file.size,
          url,
        },
      ]
    } catch (error) {
      imageError.value = error instanceof Error ? error.message : 'Failed to read image from clipboard.'
    }
  }
}

function onPaste(event: ClipboardEvent): void {
  if (!canEdit.value) return

  const files = readImageFilesFromClipboard(event)
  if (files.length === 0) return

  event.preventDefault()
  void addImageFiles(files)
}

function openImageFilePicker(): void {
  if (!canEdit.value) return
  imageInputRef.value?.click()
}

function onImageInputChange(event: Event): void {
  if (!canEdit.value) return
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return

  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) return
  void addImageFiles(files)
}

function removeImage(imageId: string): void {
  images.value = images.value.filter((image) => image.id !== imageId)
  imageError.value = ''
}

function onCompositionStart(): void {
  isComposingText.value = true
  justEndedComposition.value = false
}

function adjustComposerTextareaHeight(): void {
  const el = messageInputRef.value
  if (!el) return
  el.style.height = 'auto'
  const next = Math.min(el.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT_PX)
  el.style.height = `${next}px`
}

function onCompositionEnd(): void {
  isComposingText.value = false
  justEndedComposition.value = true
  void nextTick(() => adjustComposerTextareaHeight())
  window.setTimeout(() => {
    justEndedComposition.value = false
  }, 0)
}

function onDraftInput(): void {
  refreshTriggerSuggestions()
}

function onDraftCursorMove(event: KeyboardEvent): void {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter' || event.key === 'Tab') {
    return
  }
  refreshTriggerSuggestions()
}

function onInputKeydown(event: KeyboardEvent): void {
  if (triggerMenuOpen.value && triggerSuggestions.value.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      triggerActiveIndex.value = (triggerActiveIndex.value + 1) % triggerSuggestions.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      triggerActiveIndex.value =
        (triggerActiveIndex.value - 1 + triggerSuggestions.value.length) % triggerSuggestions.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      applyTriggerSuggestion(triggerActiveIndex.value)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeTriggerMenu()
      return
    }
  }

  if (event.key !== 'Enter') return
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.isComposing || event.keyCode === 229 || isComposingText.value || justEndedComposition.value) {
    return
  }

  event.preventDefault()
  onSubmit()
}

async function onSpeechToggle(): Promise<void> {
  if (!canUseSpeech.value) return
  speech.clearError()
  await speech.toggle(draft.value, (next) => {
    draft.value = next
  })
}

function onSubmit(): void {
  speech.stop()
  const text = draft.value.trim()
  if (!canSubmit.value) return
  emit('submit', { text, images: images.value })
  closeTriggerMenu()
  draft.value = ''
  images.value = []
  imageError.value = ''
  void nextTick(() => adjustComposerTextareaHeight())
}

function onInterrupt(): void {
  emit('interrupt')
}

function onModelSelect(value: string): void {
  emit('update:selected-model', value)
}

function onReasoningEffortSelect(value: string): void {
  emit('update:selected-reasoning-effort', value as ReasoningEffort)
}

function onPermissionModeSelect(value: string): void {
  if (value === 'default' || value === 'full-access') {
    emit('update:permission-mode', value)
  }
}

watch(
  () => props.activeThreadId,
  () => {
    worktreeModalOpen.value = false
    clearWorktreeStatusTimer()
    worktreeStatusText.value = ''
    speech.stop()
    speech.clearError()
    closeTriggerMenu()
    draft.value = ''
    images.value = []
    imageError.value = ''
    void nextTick(() => adjustComposerTextareaHeight())
  },
)

watch(
  () => props.threadCwd,
  () => {
    worktreeModalOpen.value = false
    clearWorktreeStatusTimer()
    worktreeStatusText.value = ''
  },
)

watch(
  draft,
  () => {
    void nextTick(() => adjustComposerTextareaHeight())
  },
  { flush: 'post' },
)

onMounted(() => {
  void nextTick(() => adjustComposerTextareaHeight())
  window.addEventListener('resize', onWindowRelayoutForTriggerMenu)
  window.addEventListener('scroll', onWindowRelayoutForTriggerMenu, true)
})

onBeforeUnmount(() => {
  clearAtDebounce()
})

onUnmounted(() => {
  clearWorktreeStatusTimer()
  window.removeEventListener('resize', onWindowRelayoutForTriggerMenu)
  window.removeEventListener('scroll', onWindowRelayoutForTriggerMenu, true)
})
</script>

<style scoped>
@reference "tailwindcss";

.thread-composer {
  @apply box-border mx-auto w-full min-w-0 max-w-175 px-3 sm:px-6;
}

.thread-composer-shell {
  @apply w-full min-w-0 max-w-full rounded-2xl border border-zinc-300 bg-white p-3 shadow-sm;
}

.thread-composer-message-row {
  @apply relative w-full min-w-0;
}

.thread-composer-message-row .thread-composer-input {
  @apply w-full min-w-0;
}

.thread-composer-footer-controls {
  @apply flex min-h-8 min-w-0 max-w-full flex-nowrap items-center gap-x-2;
}

.thread-composer-footer {
  @apply mt-1 flex w-full min-w-0 flex-nowrap items-center justify-between gap-x-2;
}

.thread-composer-actions-rail {
  @apply flex shrink-0 flex-row items-center gap-1.5;
}

.thread-composer-input {
  @apply box-border min-h-11 w-full min-w-0 max-h-40 resize-none overflow-y-auto rounded-xl border-0 bg-transparent px-1 pt-3 pb-2 text-sm leading-5 text-zinc-900 outline-none transition-colors break-words [overflow-wrap:anywhere];
}

.thread-composer-input:focus {
  @apply ring-0;
}

.thread-composer-input:disabled {
  @apply bg-zinc-100 text-zinc-500 cursor-not-allowed;
}

.thread-composer-input[readonly] {
  @apply cursor-default;
}

.thread-composer-trigger-menu {
  @apply absolute left-0 right-0 z-20 flex max-h-[min(13rem,calc(100dvh-5rem))] min-h-0 flex-col overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-200 bg-white p-1 shadow-lg;
}

.thread-composer-trigger-menu:not(.thread-composer-trigger-menu--flip-up) {
  @apply top-full mt-1;
}

.thread-composer-trigger-menu--flip-up {
  @apply bottom-full mb-1;
}

.thread-composer-trigger-item {
  @apply flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100;
}

.thread-composer-trigger-item--active {
  @apply bg-zinc-100;
}

.thread-composer-trigger-item-label {
  @apply min-w-0 max-w-[min(50%,11rem)] shrink truncate font-mono text-xs text-zinc-900;
}

.thread-composer-trigger-item-desc {
  @apply min-w-0 flex-1 truncate text-right text-[11px] text-zinc-500;
}

.thread-composer-image-list {
  @apply mb-3 flex list-none flex-wrap gap-2 p-0;
}

.thread-composer-image-item {
  @apply relative m-0 h-16 w-16 overflow-hidden rounded-lg border border-zinc-300 bg-white;
}

.thread-composer-image-preview {
  @apply h-full w-full object-cover;
}

.thread-composer-image-remove {
  @apply absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200 bg-white text-xs font-semibold text-zinc-700 shadow-sm hover:bg-zinc-100;
}

.thread-composer-image-error {
  @apply mt-1 text-xs text-red-600;
}

.thread-composer-speech-error {
  @apply mt-1 text-xs text-red-600;
}

.thread-composer-speech-status {
  @apply mt-2 text-sm font-medium text-zinc-600;
}

.thread-composer-mic--starting {
  @apply border-zinc-200 bg-zinc-100 text-zinc-700;
}

.thread-composer-mic--starting .thread-composer-mic-icon {
  @apply animate-pulse;
}

/* Match .thread-composer-shell horizontal padding (p-3) so worktree aligns with model row and permission with send */
.thread-composer-bottom-bar {
  @apply mt-1 w-full min-w-0 px-3;
}

.thread-composer-permission-outside {
  @apply flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1;
}

.thread-composer-permission-outside-left {
  @apply flex min-w-0 shrink-0 items-center;
}

.thread-composer-new-worktree {
  @apply inline-flex h-8 items-center gap-1.5 rounded-lg border border-transparent bg-transparent px-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-zinc-600;
}

.thread-composer-new-worktree-icon {
  @apply h-3.5 w-3.5 shrink-0 text-current;
}

.thread-composer-worktree-status {
  @apply mt-1 max-w-full break-words text-xs text-zinc-500;
}

.thread-composer-permission-outside-dropdown {
  @apply min-w-0 max-w-[min(100%,13rem)] shrink-0;
}

.thread-composer-file-input {
  @apply hidden;
}

.thread-composer-add-files {
  @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent bg-transparent text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent;
}

.thread-composer-add-files-icon {
  @apply h-5 w-5;
}

.thread-composer-mic {
  @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent bg-transparent text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none;
}

.thread-composer-mic:disabled {
  @apply cursor-not-allowed opacity-35 text-zinc-300 hover:bg-transparent;
}

.thread-composer-mic:disabled:hover {
  @apply bg-transparent text-zinc-300;
}

.thread-composer-mic--listening {
  @apply border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800;
}

.thread-composer-mic-icon {
  @apply h-5 w-5;
}

.thread-composer-control {
  @apply min-w-0 max-w-[min(100%,11rem)] shrink sm:max-w-[14rem];
}

.thread-composer-permission {
  @apply min-w-0 max-w-full sm:max-w-[11rem];
}

.thread-composer-context-usage {
  @apply inline-flex shrink-0 items-center justify-center;
}

.thread-composer-context-ring {
  @apply h-4 w-4;
}

.thread-composer-context-ring-track {
  @apply stroke-zinc-200;
}

.thread-composer-context-ring-fill {
  @apply stroke-zinc-500 transition-[stroke-dashoffset] duration-300 ease-out;
}

.thread-composer-context-usage[data-level='warning'] .thread-composer-context-ring-fill {
  @apply stroke-amber-500;
}

.thread-composer-context-usage[data-level='danger'] .thread-composer-context-ring-fill {
  @apply stroke-rose-500;
}

.thread-composer-submit {
  @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-zinc-900 text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500;
}

.thread-composer-submit-icon {
  @apply h-5 w-5;
}

.thread-composer-stop {
  @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-zinc-900 text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500;
}

.thread-composer-stop-icon {
  @apply h-5 w-5;
}
</style>
