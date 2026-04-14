<template>
  <Teleport to="body">
    <div v-if="open" :data-theme="theme" class="directory-picker-root">
      <div class="directory-picker-backdrop" @click="onRequestClose" />
      <div
        class="directory-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="directory-picker-title"
        @click.stop
      >
        <div class="directory-picker-header">
          <h2 id="directory-picker-title" class="directory-picker-title">Choose project folder</h2>
          <button class="directory-picker-close" type="button" aria-label="Close" @click="onRequestClose">
            ×
          </button>
        </div>

        <p v-if="errorMessage" class="directory-picker-error">{{ errorMessage }}</p>

        <div class="directory-picker-path-row">
          <span class="directory-picker-path-label">Path</span>
          <code class="directory-picker-path-value">{{ displayPath }}</code>
        </div>

        <div v-if="roots.length > 1 && !currentPath" class="directory-picker-roots">
          <span class="directory-picker-section-label">Roots</span>
          <ul class="directory-picker-root-list">
            <li v-for="root in roots" :key="root">
              <button class="directory-picker-row" type="button" @click="openPath(root)">
                {{ root }}
              </button>
            </li>
          </ul>
        </div>

        <div class="directory-picker-toolbar">
          <button
            class="directory-picker-tool"
            type="button"
            aria-label="Parent directory"
            :disabled="!parentPath || loading"
            @click="openPath(parentPath!)"
          >
            ..
          </button>
          <input
            id="directory-picker-folder-filter"
            v-model="filterQuery"
            class="directory-picker-filter"
            type="search"
            name="directory-picker-folder-filter"
            placeholder="Filter"
            aria-label="Filter folders"
            autocomplete="off"
          />
        </div>

        <div class="directory-picker-list-wrap">
          <ul class="directory-picker-list">
            <li v-for="entry in filteredDirectories" :key="entry.path">
              <button class="directory-picker-row" type="button" @click="openPath(entry.path)">
                <span class="directory-picker-folder-icon" aria-hidden="true" />
                {{ entry.name }}
              </button>
            </li>
          </ul>
          <p v-if="!loading && currentPath && filteredDirectories.length === 0" class="directory-picker-empty">
            No subfolders
          </p>
        </div>

        <form class="directory-picker-manual" @submit.prevent="onManualSubmit">
          <label class="directory-picker-manual-label" for="directory-picker-manual-input">Manual path</label>
          <div class="directory-picker-manual-row">
            <input
              id="directory-picker-manual-input"
              v-model="manualPath"
              class="directory-picker-manual-input"
              type="text"
              name="directory-picker-manual-path"
              autocomplete="off"
              placeholder="/absolute/path/to/folder"
            />
            <button class="directory-picker-manual-go" type="submit" :disabled="loading">Go</button>
          </div>
        </form>

        <div v-if="newFolderOpen" class="directory-picker-new-folder">
          <input
            id="directory-picker-new-folder-name"
            ref="newFolderInputRef"
            v-model="newFolderName"
            class="directory-picker-new-folder-input"
            type="text"
            name="directory-picker-new-folder-name"
            autocomplete="off"
            placeholder="Folder name"
            aria-label="New folder name"
            @keydown.enter.prevent="submitNewFolder"
          />
          <button
            class="directory-picker-new-folder-create"
            type="button"
            :disabled="loading || !newFolderName.trim()"
            @click="submitNewFolder"
          >
            Create
          </button>
          <button class="directory-picker-new-folder-dismiss" type="button" :disabled="loading" @click="closeNewFolder">
            Cancel
          </button>
        </div>

        <div class="directory-picker-actions">
          <button class="directory-picker-cancel" type="button" @click="onRequestClose">Cancel</button>
          <div class="directory-picker-actions-trailing">
            <button
              class="directory-picker-cancel"
              type="button"
              :disabled="!canMakeNewFolder || loading"
              @click="onNewFolderToggle"
            >
              New folder
            </button>
            <button
              class="directory-picker-confirm"
              type="button"
              :disabled="!canConfirm || loading"
              @click="onConfirm"
            >
              Choose this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { createFsDirectory, fetchFsDirectories } from '../../api/fsDirectoriesClient'
import type { FsDirectoryEntry } from '../../types/fsDirectories'

const props = withDefaults(
  defineProps<{
    open: boolean
    theme?: 'dark' | 'light'
  }>(),
  {
    theme: 'light',
  },
)

const emit = defineEmits<{
  close: []
  confirm: [path: string]
}>()

const loading = ref(false)
const errorMessage = ref('')
const roots = ref<string[]>([])
const currentPath = ref('')
const parentPath = ref<string | null>(null)
const directories = ref<FsDirectoryEntry[]>([])
const filterQuery = ref('')
const manualPath = ref('')
const newFolderOpen = ref(false)
const newFolderName = ref('')
const newFolderInputRef = ref<HTMLInputElement | null>(null)

const displayPath = computed(() => (currentPath.value.trim().length > 0 ? currentPath.value : '(select a root)'))

const canConfirm = computed(() => currentPath.value.trim().length > 0)
const canMakeNewFolder = computed(() => currentPath.value.trim().length > 0)

const filteredDirectories = computed(() => {
  const q = filterQuery.value.trim().toLowerCase()
  if (!q) return directories.value
  return directories.value.filter((d) => d.name.toLowerCase().includes(q))
})

async function loadPath(path: string): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await fetchFsDirectories(path)
    roots.value = data.roots
    if (!data.path.trim() && data.roots.length === 1) {
      await loadPath(data.roots[0])
      return
    }
    currentPath.value = data.path
    parentPath.value = data.parentPath
    directories.value = data.directories
    if (data.path.trim().length > 0) {
      manualPath.value = data.path
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load directories'
  } finally {
    loading.value = false
  }
}

function openPath(path: string): void {
  void loadPath(path)
}

async function onManualSubmit(): Promise<void> {
  const next = manualPath.value.trim()
  if (!next) return
  await loadPath(next)
}

function onConfirm(): void {
  const path = currentPath.value.trim()
  if (!path) return
  emit('confirm', path)
}

function isValidNewFolderName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 255) return false
  if (trimmed === '.' || trimmed === '..') return false
  if (/[/\\]/.test(trimmed)) return false
  if (trimmed.includes('\0')) return false
  return true
}

function closeNewFolder(): void {
  newFolderOpen.value = false
  newFolderName.value = ''
}

async function onNewFolderToggle(): Promise<void> {
  if (!canMakeNewFolder.value) return
  newFolderOpen.value = !newFolderOpen.value
  if (newFolderOpen.value) {
    newFolderName.value = ''
    await nextTick()
    newFolderInputRef.value?.focus()
  }
}

async function submitNewFolder(): Promise<void> {
  const parent = currentPath.value.trim()
  const name = newFolderName.value.trim()
  if (!parent || !name) return
  if (!isValidNewFolderName(name)) {
    errorMessage.value = 'Invalid folder name'
    return
  }

  errorMessage.value = ''
  try {
    await createFsDirectory(parent, name)
    closeNewFolder()
    await loadPath(parent)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to create folder'
  }
}

function onRequestClose(): void {
  closeNewFolder()
  emit('close')
}

function onGlobalKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  onRequestClose()
}

watch(
  () => props.open,
  (isOpen) => {
    if (typeof window === 'undefined') return
    if (isOpen) {
      filterQuery.value = ''
      manualPath.value = ''
      errorMessage.value = ''
      closeNewFolder()
      window.addEventListener('keydown', onGlobalKeyDown)
      void loadPath('')
      return
    }
    window.removeEventListener('keydown', onGlobalKeyDown)
  },
)

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('keydown', onGlobalKeyDown)
})
</script>

<style scoped>
@reference "tailwindcss";

.directory-picker-root {
  @apply pointer-events-none fixed inset-0 z-[200] flex items-center justify-center p-4;
}

.directory-picker-backdrop {
  @apply pointer-events-auto absolute inset-0 bg-black/40;
}

.directory-picker-dialog {
  @apply pointer-events-auto relative flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl;
}

.directory-picker-header {
  @apply flex shrink-0 items-start justify-between gap-2;
}

.directory-picker-title {
  @apply text-base font-semibold text-zinc-900;
}

.directory-picker-close {
  @apply -mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-xl leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800;
}

.directory-picker-error {
  @apply shrink-0 rounded-lg bg-rose-50 px-2 py-1.5 text-sm text-rose-800;
}

.directory-picker-path-row {
  @apply flex min-w-0 shrink-0 flex-col gap-1;
}

.directory-picker-path-label {
  @apply text-xs font-medium text-zinc-500;
}

.directory-picker-path-value {
  @apply block min-w-0 break-all rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-800;
}

.directory-picker-section-label {
  @apply mb-1 block text-xs font-medium text-zinc-500;
}

.directory-picker-roots {
  @apply flex max-h-40 shrink-0 flex-col gap-1 overflow-y-auto;
}

.directory-picker-root-list {
  @apply m-0 list-none p-0;
}

.directory-picker-toolbar {
  @apply flex min-w-0 shrink-0 items-center gap-2;
}

.directory-picker-filter {
  @apply min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400;
}

.directory-picker-tool {
  @apply rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-800 transition enabled:hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40;
}

/*
 * Scroll container: fixed height band (do not use flex-1 here — parent has no definite height).
 * Use overflow-y: scroll + visible scrollbar — global .codex-subtle-scroll hides the thumb until hover,
 * so users cannot tell there are more folders below.
 */
.directory-picker-list-wrap {
  @apply min-h-[12rem] max-h-[min(70vh,32rem)] shrink-0 overflow-y-scroll overscroll-contain rounded-lg border border-zinc-200 bg-zinc-50/80;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgb(161 161 170) rgb(244 244 245);
}

.directory-picker-list-wrap::-webkit-scrollbar {
  width: 10px;
}

.directory-picker-list-wrap::-webkit-scrollbar-track {
  @apply rounded bg-zinc-100;
}

.directory-picker-list-wrap::-webkit-scrollbar-thumb {
  @apply rounded-full bg-zinc-400;
}

.directory-picker-list-wrap::-webkit-scrollbar-thumb:hover {
  @apply bg-zinc-500;
}

.directory-picker-list {
  @apply m-0 list-none p-0;
}

.directory-picker-row {
  @apply flex w-full min-w-0 items-center gap-2 border-0 bg-transparent px-2 py-1.5 text-left text-sm text-zinc-800 transition hover:bg-zinc-200/80;
}

.directory-picker-folder-icon {
  @apply inline-block h-4 w-4 shrink-0 rounded-sm border border-zinc-400 bg-zinc-100;
}

.directory-picker-empty {
  @apply m-0 px-2 py-3 text-center text-sm text-zinc-500;
}

.directory-picker-manual {
  @apply flex shrink-0 flex-col gap-1;
}

.directory-picker-manual-label {
  @apply text-xs font-medium text-zinc-500;
}

.directory-picker-manual-row {
  @apply flex min-w-0 gap-1;
}

.directory-picker-manual-input {
  @apply min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400;
}

.directory-picker-manual-go {
  @apply shrink-0 rounded-lg border border-zinc-200 bg-zinc-900 px-2 py-1.5 text-sm text-white transition hover:bg-black disabled:opacity-40;
}

.directory-picker-new-folder {
  @apply flex min-w-0 shrink-0 flex-wrap items-center gap-2 rounded-lg border border-dashed border-zinc-200 bg-zinc-50/80 px-2 py-2;
}

.directory-picker-new-folder-input {
  @apply min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400;
}

.directory-picker-new-folder-create {
  @apply shrink-0 rounded-lg border border-zinc-200 bg-zinc-900 px-2 py-1.5 text-sm text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40;
}

.directory-picker-new-folder-dismiss {
  @apply shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-40;
}

.directory-picker-actions {
  @apply mt-1 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3;
}

.directory-picker-actions-trailing {
  @apply flex min-w-0 flex-wrap items-center justify-end gap-2;
}

.directory-picker-cancel {
  @apply rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 transition hover:bg-zinc-100;
}

.directory-picker-confirm {
  @apply rounded-lg border border-zinc-200 bg-zinc-900 px-3 py-1.5 text-sm text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40;
}
</style>
