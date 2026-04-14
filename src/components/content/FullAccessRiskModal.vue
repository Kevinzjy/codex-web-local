<template>
  <Teleport to="body">
    <div v-if="open" :data-theme="theme" class="full-access-risk-root">
      <div class="full-access-risk-backdrop" @click="onCancel" />
      <div
        class="full-access-risk-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="full-access-risk-title"
        @click.stop
      >
        <h2 id="full-access-risk-title" class="full-access-risk-title">Enable full access?</h2>
        <p class="full-access-risk-body">
          Full access runs commands without asking for approval and uses unrestricted sandbox settings for this
          thread. Only use this on trusted machines and repositories.
        </p>
        <div class="full-access-risk-actions">
          <button class="full-access-risk-cancel" type="button" @click="onCancel">Cancel</button>
          <button class="full-access-risk-confirm" type="button" @click="onConfirm">Continue</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    open: boolean
    theme?: 'dark' | 'light'
  }>(),
  { theme: 'light' },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function onConfirm(): void {
  emit('confirm')
}

function onCancel(): void {
  emit('cancel')
}
</script>

<style scoped>
@reference "tailwindcss";

.full-access-risk-root {
  @apply pointer-events-none fixed inset-0 z-[210] flex items-center justify-center p-4;
}

.full-access-risk-backdrop {
  @apply pointer-events-auto absolute inset-0 bg-black/40;
}

.full-access-risk-dialog {
  @apply pointer-events-auto relative max-h-[85vh] w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl;
}

.full-access-risk-title {
  @apply text-base font-semibold text-zinc-900;
}

.full-access-risk-body {
  @apply mt-2 text-sm leading-relaxed text-zinc-600;
}

.full-access-risk-actions {
  @apply mt-4 flex justify-end gap-2 border-t border-zinc-100 pt-3;
}

.full-access-risk-cancel {
  @apply rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 transition hover:bg-zinc-100;
}

.full-access-risk-confirm {
  @apply rounded-lg border border-zinc-200 bg-zinc-900 px-3 py-1.5 text-sm text-white transition hover:bg-black;
}
</style>
