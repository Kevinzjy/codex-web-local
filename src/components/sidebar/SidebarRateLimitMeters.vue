<template>
  <section class="sidebar-rate-limits" aria-label="Codex quota">
    <article v-for="meter in meters" :key="meter.label" class="sidebar-rate-limit-card">
      <div class="sidebar-rate-limit-header">
        <span class="sidebar-rate-limit-title">{{ meter.label }}</span>
        <span class="sidebar-rate-limit-percent" :data-level="meterLevel(meter.window)">
          {{ meterPercentLabel(meter.window) }}
        </span>
      </div>
      <div
        class="sidebar-rate-limit-track"
        role="progressbar"
        :aria-label="`${meter.label} remaining`"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuenow="meterRemainingPercent(meter.window)"
      >
        <span
          class="sidebar-rate-limit-fill"
          :data-level="meterLevel(meter.window)"
          :style="{ width: `${meterRemainingPercent(meter.window)}%` }"
        />
      </div>
      <p class="sidebar-rate-limit-reset">{{ meterResetLabel(meter.window) }}</p>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RateLimitSnapshot, RateLimitWindow } from '../../api/appServerDtos'

const FIVE_HOUR_LIMIT_MINS = 5 * 60
const ONE_WEEK_LIMIT_MINS = 7 * 24 * 60

const props = defineProps<{
  rateLimits: RateLimitSnapshot | null
  isLoading: boolean
  error: string
}>()

const resetFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const meters = computed(() => [
  {
    label: '5h limit',
    window: selectRateLimitWindow(FIVE_HOUR_LIMIT_MINS, props.rateLimits?.primary ?? null),
  },
  {
    label: '1 week limit',
    window: selectRateLimitWindow(ONE_WEEK_LIMIT_MINS, props.rateLimits?.secondary ?? null),
  },
])

function selectRateLimitWindow(targetDurationMins: number, fallback: RateLimitWindow | null): RateLimitWindow | null {
  const windows = [props.rateLimits?.primary ?? null, props.rateLimits?.secondary ?? null]
    .filter((window): window is RateLimitWindow => window !== null)
  const tolerance = targetDurationMins === FIVE_HOUR_LIMIT_MINS ? 5 : 60
  const exactWindow = windows.find(
    (window) =>
      typeof window.windowDurationMins === 'number' &&
      Math.abs(window.windowDurationMins - targetDurationMins) <= tolerance,
  )

  return exactWindow ?? fallback
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function meterRemainingPercent(window: RateLimitWindow | null): number {
  if (!window) return 0
  return Math.round(clampPercent(100 - window.usedPercent))
}

function meterPercentLabel(window: RateLimitWindow | null): string {
  if (props.isLoading && !window) return 'Loading'
  if (props.error || !window) return 'Unavailable'
  return `${String(meterRemainingPercent(window))}% remaining`
}

function meterLevel(window: RateLimitWindow | null): 'normal' | 'warning' | 'danger' {
  if (!window) return 'normal'
  const remainingPercent = meterRemainingPercent(window)
  if (remainingPercent <= 10) return 'danger'
  if (remainingPercent <= 25) return 'warning'
  return 'normal'
}

function normalizedResetTimeMs(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value < 1_000_000_000_000 ? value * 1000 : value
}

function meterResetLabel(window: RateLimitWindow | null): string {
  if (props.isLoading && !window) return 'Loading quota...'
  if (props.error || !window) return 'Quota unavailable'

  const resetTimeMs = normalizedResetTimeMs(window.resetsAt)
  if (!resetTimeMs) return 'Reset time unavailable'
  return `Resets ${resetFormatter.format(new Date(resetTimeMs))}`
}
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-rate-limits {
  @apply mt-auto flex flex-col gap-1.5 px-2 pt-2 pb-0.5;
}

.sidebar-rate-limit-card {
  @apply rounded-md border border-zinc-200/70 bg-white/35 px-2.5 py-2;
}

.sidebar-rate-limit-header {
  @apply flex items-baseline justify-between gap-2;
}

.sidebar-rate-limit-title {
  @apply min-w-0 truncate text-[0.6875rem] font-medium leading-4 text-zinc-500;
}

.sidebar-rate-limit-percent {
  @apply shrink-0 text-[0.6875rem] font-semibold leading-4 text-zinc-700;
}

.sidebar-rate-limit-percent[data-level='warning'] {
  @apply text-amber-600;
}

.sidebar-rate-limit-percent[data-level='danger'] {
  @apply text-rose-600;
}

.sidebar-rate-limit-track {
  @apply mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-200/80;
}

.sidebar-rate-limit-fill {
  @apply block h-full rounded-full bg-emerald-500/85 transition-[width] duration-300;
}

.sidebar-rate-limit-fill[data-level='warning'] {
  @apply bg-amber-500;
}

.sidebar-rate-limit-fill[data-level='danger'] {
  @apply bg-rose-500;
}

.sidebar-rate-limit-reset {
  @apply mt-1.5 mb-0 truncate text-[0.6875rem] leading-4 text-zinc-400;
}

</style>
