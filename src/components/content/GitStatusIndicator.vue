<template>
  <div
    v-if="display !== null"
    class="git-status"
    :title="tooltip"
    aria-live="polite"
  >
    <span v-if="isLoading" class="git-status-loading">…</span>
    <template v-else>
      <div class="git-status-row">
        <div class="git-status-branch-cell">
          <span class="git-status-branch">{{ display.branchLabel }}</span>
          <span
            v-if="display.syncHint"
            class="git-status-sync"
          >{{ display.syncHint }}</span>
        </div>
        <div
          v-if="display.showLineDiff"
          class="git-status-diff-cell"
        >
          <span class="git-lines-added">+{{ display.insertions }}</span>
          <span class="git-lines-removed">−{{ display.deletions }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { UiGitStatus } from '../../types/codex'

const props = defineProps<{
  status: UiGitStatus | null
  isLoading?: boolean
}>()

type DisplayOk = {
  branchLabel: string
  syncHint: string | null
  showLineDiff: boolean
  insertions: number
  deletions: number
}

const display = computed((): DisplayOk | null => {
  if (props.isLoading) {
    return {
      branchLabel: '',
      syncHint: null,
      showLineDiff: false,
      insertions: 0,
      deletions: 0,
    }
  }

  const status = props.status
  if (!status) {
    return null
  }

  if (status.ok === true && status.isRepo === false) {
    if (status.reason === 'not_allowed') {
      return {
        branchLabel: 'Path not allowed',
        syncHint: null,
        showLineDiff: false,
        insertions: 0,
        deletions: 0,
      }
    }
    if (status.reason === 'not_found') {
      return {
        branchLabel: 'Path unavailable',
        syncHint: null,
        showLineDiff: false,
        insertions: 0,
        deletions: 0,
      }
    }
    return {
      branchLabel: 'No git repo',
      syncHint: null,
      showLineDiff: false,
      insertions: 0,
      deletions: 0,
    }
  }

  if (status.ok === true && status.isRepo === true) {
    const branchLabel = status.detached
      ? `detached@${status.headShortSha ?? '…'}`
      : (status.branch ?? '…')

    const syncParts: string[] = []
    if (status.ahead > 0) syncParts.push(`↑${String(status.ahead)}`)
    if (status.behind > 0) syncParts.push(`↓${String(status.behind)}`)
    const syncHint = syncParts.length > 0 ? syncParts.join(' ') : null

    return {
      branchLabel,
      syncHint,
      showLineDiff: true,
      insertions: status.lineInsertions,
      deletions: status.lineDeletions,
    }
  }

  return {
    branchLabel: 'Git unavailable',
    syncHint: null,
    showLineDiff: false,
    insertions: 0,
    deletions: 0,
  }
})

const tooltip = computed(() => {
  const status = props.status
  if (!status) {
    return ''
  }

  if (status.ok === true && status.isRepo === true) {
    const parts: string[] = []
    if (status.detached && status.headShortSha) {
      parts.push(`detached at ${status.headShortSha}`)
    } else if (status.branch) {
      parts.push(`branch ${status.branch}`)
    }
    if (status.ahead > 0 || status.behind > 0) {
      parts.push(`ahead ${String(status.ahead)}, behind ${String(status.behind)}`)
    }
    parts.push(
      `diff vs HEAD: +${String(status.lineInsertions)} −${String(status.lineDeletions)} lines (numstat; untracked files not counted)`,
    )
    return parts.join(' · ')
  }

  if (status.ok === true && status.isRepo === false) {
    return `cwd: ${status.cwd}`
  }

  return `${status.message} (${status.code})`
})
</script>

<style scoped>
@reference "tailwindcss";

.git-status {
  @apply inline-flex max-w-[22rem] items-center bg-transparent px-0 py-0 text-sm leading-6;
}

.git-status-loading {
  @apply text-slate-400;
}

.git-status-row {
  @apply flex flex-row items-center justify-between gap-3 w-full min-w-0;
}

.git-status-branch-cell {
  @apply flex items-center gap-1.5 min-w-0 flex-1;
}

.git-status-branch {
  @apply min-w-0 flex-1 truncate text-sm font-medium leading-6 text-slate-900;
}

.git-status-sync {
  @apply shrink-0 text-xs tabular-nums leading-6 text-slate-500;
}

.git-status-diff-cell {
  @apply flex items-center justify-end gap-2 shrink-0 text-sm leading-6 tabular-nums tracking-tight;
}

.git-lines-added {
  @apply font-medium;
  color: rgb(52 105 78);
}

.git-lines-removed {
  @apply font-medium;
  color: rgb(142 72 88);
}
</style>

<style>
[data-theme='dark'] .git-status {
  background-color: transparent;
}

[data-theme='dark'] .git-status .git-status-branch {
  color: #f4f4f5;
}

[data-theme='dark'] .git-status .git-status-sync {
  color: #a1a1aa;
}

[data-theme='dark'] .git-status .git-status-loading {
  color: #a1a1aa;
}

[data-theme='dark'] .git-status .git-lines-added {
  color: rgb(118 158 138);
}

[data-theme='dark'] .git-status .git-lines-removed {
  color: rgb(192 138 148);
}
</style>
