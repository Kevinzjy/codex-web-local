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

      <textarea
        v-model="draft"
        class="thread-composer-input"
        rows="1"
        :placeholder="placeholderText"
        :disabled="disabled || !activeThreadId || isTurnInProgress"
        @keydown="onInputKeydown"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
        @paste="onPaste"
      />

      <p v-if="imageError" class="thread-composer-image-error" role="status">{{ imageError }}</p>

      <input
        ref="imageInputRef"
        class="thread-composer-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        @change="onImageInputChange"
      />

      <div class="thread-composer-controls">
        <button
          class="thread-composer-add-files"
          type="button"
          aria-label="Add photos and files"
          title="Add photos and files"
          :disabled="!canEdit"
          @click="openImageFilePicker"
        >
          <IconTablerPlus class="thread-composer-add-files-icon" />
        </button>

        <ComposerDropdown
          class="thread-composer-control"
          :model-value="selectedModel"
          :options="modelOptions"
          placeholder="Model"
          open-direction="up"
          :disabled="disabled || !activeThreadId || models.length === 0 || isTurnInProgress"
          @update:model-value="onModelSelect"
        />

        <ComposerDropdown
          class="thread-composer-control"
          :model-value="selectedReasoningEffort"
          :options="reasoningOptions"
          placeholder="Thinking"
          open-direction="up"
          :disabled="disabled || !activeThreadId || isTurnInProgress"
          @update:model-value="onReasoningEffortSelect"
        />

        <span
          v-if="contextUsageLabel"
          class="thread-composer-context-usage"
          :data-level="contextUsageLevel"
          :aria-label="`Context used ${contextUsageLabel}`"
          :title="`Context used ${contextUsageLabel}`"
        >
          {{ contextUsageLabel }}
        </span>

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
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReasoningEffort, UiComposerDraft, UiComposerImage } from '../../types/codex'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerPlayerStopFilled from '../icons/IconTablerPlayerStopFilled.vue'
import IconTablerPlus from '../icons/IconTablerPlus.vue'
import ComposerDropdown from './ComposerDropdown.vue'

const MAX_IMAGE_COUNT = 8
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const props = defineProps<{
  activeThreadId: string
  models: string[]
  selectedModel: string
  selectedReasoningEffort: ReasoningEffort | ''
  contextUsagePercent?: number | null
  isTurnInProgress?: boolean
  isInterruptingTurn?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  submit: [draft: UiComposerDraft]
  interrupt: []
  'update:selected-model': [modelId: string]
  'update:selected-reasoning-effort': [effort: ReasoningEffort | '']
}>()

const draft = ref('')
const images = ref<UiComposerImage[]>([])
const imageError = ref('')
const imageInputRef = ref<HTMLInputElement | null>(null)
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
const contextUsageLabel = computed(() => {
  const percent = props.contextUsagePercent
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return ''
  return `Context ${String(Math.round(Math.min(100, Math.max(0, percent))))}%`
})
const contextUsageLevel = computed(() => {
  const percent = props.contextUsagePercent
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 'normal'
  if (percent >= 95) return 'danger'
  if (percent >= 80) return 'warning'
  return 'normal'
})

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

function onCompositionEnd(): void {
  isComposingText.value = false
  justEndedComposition.value = true
  window.setTimeout(() => {
    justEndedComposition.value = false
  }, 0)
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.isComposing || event.keyCode === 229 || isComposingText.value || justEndedComposition.value) {
    return
  }

  event.preventDefault()
  onSubmit()
}

function onSubmit(): void {
  const text = draft.value.trim()
  if (!canSubmit.value) return
  emit('submit', { text, images: images.value })
  draft.value = ''
  images.value = []
  imageError.value = ''
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

watch(
  () => props.activeThreadId,
  () => {
    draft.value = ''
    images.value = []
    imageError.value = ''
  },
)
</script>

<style scoped>
@reference "tailwindcss";

.thread-composer {
  @apply w-full max-w-175 mx-auto px-6;
}

.thread-composer-shell {
  @apply rounded-2xl border border-zinc-300 bg-white p-3 shadow-sm;
}

.thread-composer-input {
  @apply w-full min-w-0 min-h-11 max-h-40 resize-none rounded-xl border-0 bg-transparent px-1 py-3 text-sm leading-5 text-zinc-900 outline-none transition overflow-y-auto;
}

.thread-composer-input:focus {
  @apply ring-0;
}

.thread-composer-input:disabled {
  @apply bg-zinc-100 text-zinc-500 cursor-not-allowed;
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

.thread-composer-controls {
  @apply mt-3 flex items-center gap-4;
}

.thread-composer-file-input {
  @apply hidden;
}

.thread-composer-add-files {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent bg-transparent text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent;
}

.thread-composer-add-files-icon {
  @apply h-5 w-5;
}

.thread-composer-control {
  @apply shrink-0;
}

.thread-composer-context-usage {
  @apply shrink-0 text-xs font-medium text-zinc-500;
}

.thread-composer-context-usage[data-level='warning'] {
  @apply text-amber-600;
}

.thread-composer-context-usage[data-level='danger'] {
  @apply text-rose-600;
}

.thread-composer-submit {
  @apply ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-zinc-900 text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500;
}

.thread-composer-submit-icon {
  @apply h-5 w-5;
}

.thread-composer-stop {
  @apply ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-zinc-900 text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500;
}

.thread-composer-stop-icon {
  @apply h-5 w-5;
}
</style>
