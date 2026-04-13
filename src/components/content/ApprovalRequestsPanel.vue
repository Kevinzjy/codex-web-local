<template>
  <aside v-if="requests.length > 0" class="approval-panel" aria-live="polite">
    <p class="approval-panel-title">Approval required</p>
    <ul class="approval-list">
      <li v-for="request in requests" :key="requestKey(request)" class="approval-card">
        <div class="approval-card-header">
          <p class="approval-method">{{ approvalTitle(request) }}</p>
          <p class="approval-meta">Request #{{ request.id }} · {{ formatIsoTime(request.receivedAtIso) }}</p>
        </div>

        <dl class="approval-details">
          <div v-if="readReason(request)" class="approval-detail-row">
            <dt>Reason</dt>
            <dd>{{ readReason(request) }}</dd>
          </div>
          <div v-if="readCommand(request)" class="approval-detail-row">
            <dt>Command</dt>
            <dd><code>{{ readCommand(request) }}</code></dd>
          </div>
          <div v-if="readCwd(request)" class="approval-detail-row">
            <dt>Cwd</dt>
            <dd><code>{{ readCwd(request) }}</code></dd>
          </div>
          <div v-if="readGrantRoot(request)" class="approval-detail-row">
            <dt>Grant root</dt>
            <dd><code>{{ readGrantRoot(request) }}</code></dd>
          </div>
          <div v-if="readFileChanges(request).length > 0" class="approval-detail-row">
            <dt>Files</dt>
            <dd>{{ readFileChanges(request).join(', ') }}</dd>
          </div>
        </dl>

        <div class="approval-actions">
          <button type="button" class="approval-button approval-button-primary" @click="approve(request)">Approve</button>
          <button type="button" class="approval-button" @click="approveForSession(request)">Approve for Session</button>
          <button type="button" class="approval-button" @click="deny(request)">Deny</button>
          <button type="button" class="approval-button" @click="cancel(request)">Cancel</button>
        </div>
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
import type { UiServerRequest, UiServerRequestReply } from '../../types/codex'

defineProps<{
  requests: UiServerRequest[]
}>()

const emit = defineEmits<{
  respondServerRequest: [payload: UiServerRequestReply]
}>()

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readParams(request: UiServerRequest): Record<string, unknown> {
  return asRecord(request.params) ?? {}
}

function isLegacyApproval(request: UiServerRequest): boolean {
  return request.method === 'execCommandApproval' || request.method === 'applyPatchApproval'
}

function requestKey(request: UiServerRequest): string {
  return `${request.method}:${String(request.id)}`
}

function formatIsoTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString()
}

function approvalTitle(request: UiServerRequest): string {
  if (request.method === 'item/commandExecution/requestApproval' || request.method === 'execCommandApproval') {
    return 'Command approval'
  }
  if (request.method === 'item/fileChange/requestApproval' || request.method === 'applyPatchApproval') {
    return 'File change approval'
  }
  return request.method
}

function readReason(request: UiServerRequest): string {
  return readString(readParams(request).reason)
}

function readCommand(request: UiServerRequest): string {
  const command = readParams(request).command
  if (typeof command === 'string') return command.trim()
  if (Array.isArray(command)) {
    return command.map((part) => String(part)).join(' ').trim()
  }
  return ''
}

function readCwd(request: UiServerRequest): string {
  return readString(readParams(request).cwd)
}

function readGrantRoot(request: UiServerRequest): string {
  return readString(readParams(request).grantRoot)
}

function readFileChanges(request: UiServerRequest): string[] {
  const fileChanges = asRecord(readParams(request).fileChanges)
  return fileChanges ? Object.keys(fileChanges) : []
}

function respond(request: UiServerRequest, v2Decision: string, legacyDecision: string): void {
  emit('respondServerRequest', {
    id: request.id,
    result: {
      decision: isLegacyApproval(request) ? legacyDecision : v2Decision,
    },
  })
}

function approve(request: UiServerRequest): void {
  respond(request, 'accept', 'approved')
}

function approveForSession(request: UiServerRequest): void {
  respond(request, 'acceptForSession', 'approved_for_session')
}

function deny(request: UiServerRequest): void {
  respond(request, 'decline', 'denied')
}

function cancel(request: UiServerRequest): void {
  respond(request, 'cancel', 'abort')
}
</script>

<style scoped>
@reference "tailwindcss";

.approval-panel {
  @apply fixed bottom-5 right-5 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-zinc-300 bg-white p-3 shadow-xl;
}

.approval-panel-title {
  @apply mb-2 text-sm font-semibold text-zinc-900;
}

.approval-list {
  @apply m-0 flex max-h-[60vh] list-none flex-col gap-3 overflow-auto p-0;
}

.approval-card {
  @apply m-0 rounded-lg border border-zinc-200 bg-zinc-50 p-3;
}

.approval-card-header {
  @apply mb-2;
}

.approval-method {
  @apply text-sm font-semibold text-zinc-900;
}

.approval-meta {
  @apply mt-1 text-xs text-zinc-500;
}

.approval-details {
  @apply m-0 space-y-2 text-xs text-zinc-700;
}

.approval-detail-row {
  @apply grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2;
}

.approval-detail-row dt {
  @apply font-semibold text-zinc-500;
}

.approval-detail-row dd {
  @apply m-0 min-w-0 break-words;
}

.approval-detail-row code {
  @apply break-all rounded bg-white px-1 py-0.5 text-[0.75rem] text-zinc-900;
}

.approval-actions {
  @apply mt-3 flex flex-wrap gap-2;
}

.approval-button {
  @apply rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-100;
}

.approval-button-primary {
  @apply border-zinc-900 bg-zinc-900 text-white hover:bg-black;
}
</style>
