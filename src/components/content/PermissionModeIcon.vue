<template>
  <svg
    class="permission-mode-icon"
    :class="variant === 'full' ? 'permission-mode-icon--full' : 'permission-mode-icon--default'"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      d="M12 2.25 19.5 5.4v5.1c0 4.95-3.15 9.45-7.5 11.1C7.65 19.95 4.5 15.45 4.5 10.5V5.4L12 2.25Z"
    />
    <text
      v-if="variant === 'default'"
      x="12"
      y="14.25"
      text-anchor="middle"
      fill="currentColor"
      font-size="6.5"
      font-weight="600"
      font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    >
      &gt;_
    </text>
    <text
      v-else
      x="12"
      y="15"
      text-anchor="middle"
      fill="currentColor"
      font-size="9"
      font-weight="800"
      font-family="system-ui, sans-serif"
    >
      !
    </text>
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  variant: 'default' | 'full'
}>()
</script>

<style scoped>
@reference "tailwindcss";

.permission-mode-icon {
  @apply h-4 w-4 shrink-0;
}

.permission-mode-icon--default {
  @apply text-zinc-500;
}

.permission-mode-icon--full {
  @apply text-orange-400;
}
</style>
