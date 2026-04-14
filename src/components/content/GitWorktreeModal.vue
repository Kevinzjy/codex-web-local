<template>
  <Teleport to="body">
    <div v-if="open" :data-theme="theme" class="git-worktree-modal-root">
      <div class="git-worktree-modal-backdrop" @click="onClose" />
      <div
        class="git-worktree-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-worktree-modal-title"
        @click.stop
      >
        <h2 id="git-worktree-modal-title" class="git-worktree-modal-title">Add git worktree</h2>
        <p class="git-worktree-modal-hint">
          Same as
          <code class="git-worktree-modal-code">git worktree add &lt;path&gt; -b &lt;branch&gt;</code>
          from the repository root. Relative paths are resolved from that root.
        </p>

        <label class="git-worktree-modal-label" for="git-worktree-path">Path</label>
        <input
          id="git-worktree-path"
          v-model="path"
          class="git-worktree-modal-input"
          type="text"
          name="git-worktree-path"
          autocomplete="off"
          placeholder="../RNA-wm-flow-matching"
          :disabled="busy"
          @keydown.enter.prevent="onConfirm"
        />

        <label class="git-worktree-modal-label git-worktree-modal-label-branch" for="git-worktree-branch">Branch</label>
        <input
          id="git-worktree-branch"
          v-model="branch"
          class="git-worktree-modal-input"
          type="text"
          name="git-worktree-branch"
          autocomplete="off"
          placeholder="codex/flow-matching"
          :disabled="busy"
          @keydown.enter.prevent="onConfirm"
        />

        <fieldset class="git-worktree-modal-after" :disabled="busy">
          <legend class="git-worktree-modal-after-legend">After creation</legend>
          <label class="git-worktree-modal-radio">
            <input v-model="followUp" type="radio" class="git-worktree-modal-radio-input" value="none" />
            <span>Worktree only (don’t open a conversation)</span>
          </label>
          <label class="git-worktree-modal-radio">
            <input v-model="followUp" type="radio" class="git-worktree-modal-radio-input" value="new-thread" />
            <span>Open a new conversation in this worktree</span>
          </label>
          <label
            class="git-worktree-modal-radio"
            :class="{ 'git-worktree-modal-radio--disabled': !canFork }"
            :title="forkOptionTitle"
          >
            <input
              v-model="followUp"
              type="radio"
              class="git-worktree-modal-radio-input"
              value="fork-thread"
              :disabled="!canFork"
            />
            <span>Fork the current thread to this worktree</span>
          </label>
        </fieldset>

        <div class="git-worktree-modal-actions">
          <button class="git-worktree-modal-cancel" type="button" :disabled="busy" @click="onClose">Cancel</button>
          <button
            class="git-worktree-modal-confirm"
            type="button"
            :disabled="!canSubmit || busy"
            @click="onConfirm"
          >
            {{ busy ? 'Creating…' : 'Add worktree' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export type GitWorktreeFollowUp = 'none' | 'new-thread' | 'fork-thread'

const props = withDefaults(
  defineProps<{
    open: boolean
    theme?: 'dark' | 'light'
    /** When true, “Fork current thread” is available (e.g. on an open thread, not home). */
    canFork: boolean
    busy?: boolean
  }>(),
  { theme: 'light', busy: false },
)

const emit = defineEmits<{
  close: []
  confirm: [payload: { path: string; branch: string; followUp: GitWorktreeFollowUp }]
}>()

const path = ref('')
const branch = ref('')
const followUp = ref<GitWorktreeFollowUp>('none')

const canSubmit = computed(() => path.value.trim().length > 0 && branch.value.trim().length > 0)

const forkOptionTitle = computed(() =>
  props.canFork ? 'Copy this thread’s history into a new thread at the worktree' : 'Open a thread first to use fork',
)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      path.value = ''
      branch.value = ''
      followUp.value = 'none'
    }
  },
)

watch(
  () => props.canFork,
  (ok) => {
    if (!ok && followUp.value === 'fork-thread') {
      followUp.value = 'none'
    }
  },
)

function onClose(): void {
  if (props.busy) return
  emit('close')
}

function onConfirm(): void {
  if (!canSubmit.value || props.busy) return
  let next = followUp.value
  if (next === 'fork-thread' && !props.canFork) {
    next = 'none'
  }
  emit('confirm', { path: path.value.trim(), branch: branch.value.trim(), followUp: next })
}
</script>

<style scoped>
@reference "tailwindcss";

.git-worktree-modal-root {
  @apply pointer-events-none fixed inset-0 z-[210] flex items-center justify-center p-4;
}

.git-worktree-modal-backdrop {
  @apply pointer-events-auto absolute inset-0 bg-black/40;
}

.git-worktree-modal-dialog {
  @apply pointer-events-auto relative max-h-[85vh] w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl;
}

.git-worktree-modal-title {
  @apply text-base font-semibold text-zinc-900;
}

.git-worktree-modal-hint {
  @apply mt-2 text-sm leading-relaxed text-zinc-600;
}

.git-worktree-modal-code {
  @apply rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs text-zinc-800;
}

.git-worktree-modal-label {
  @apply mt-3 block text-xs font-medium text-zinc-700;
}

.git-worktree-modal-label-branch {
  @apply mt-2;
}

.git-worktree-modal-input {
  @apply mt-1 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500;
}

.git-worktree-modal-after {
  @apply mt-4 space-y-2.5 border-0 p-0;
}

.git-worktree-modal-after:disabled {
  @apply opacity-60;
}

.git-worktree-modal-after-legend {
  @apply mb-2 block text-xs font-medium text-zinc-700;
}

.git-worktree-modal-radio {
  @apply flex cursor-pointer items-start gap-2 text-sm leading-snug text-zinc-700;
}

.git-worktree-modal-radio--disabled {
  @apply cursor-not-allowed text-zinc-400;
}

.git-worktree-modal-radio-input {
  @apply mt-0.5 shrink-0;
}

.git-worktree-modal-actions {
  @apply mt-4 flex justify-end gap-2 border-t border-zinc-100 pt-3;
}

.git-worktree-modal-cancel {
  @apply rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50;
}

.git-worktree-modal-confirm {
  @apply rounded-lg border border-zinc-200 bg-zinc-900 px-3 py-1.5 text-sm text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500;
}
</style>
