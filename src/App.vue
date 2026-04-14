<template>
  <DesktopLayout :is-sidebar-collapsed="isSidebarCollapsed" :data-theme="themeName">
    <template #sidebar>
      <section class="sidebar-root">
        <SidebarThreadControls
          v-if="!isSidebarCollapsed"
          class="sidebar-thread-controls-host"
          :is-sidebar-collapsed="isSidebarCollapsed"
          :is-auto-refresh-enabled="isAutoRefreshEnabled"
          :auto-refresh-button-label="autoRefreshButtonLabel"
          :show-new-thread-button="true"
          @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
          @toggle-auto-refresh="onToggleAutoRefreshTimer"
          @start-new-thread="onStartNewThreadFromToolbar"
        >
          <button
            class="theme-toggle-button"
            type="button"
            :aria-pressed="isDarkMode"
            :aria-label="themeToggleLabel"
            :title="themeToggleLabel"
            @click="toggleDarkMode"
          >
            <IconTablerSun v-if="isDarkMode" class="theme-toggle-icon" />
            <IconTablerMoon v-else class="theme-toggle-icon" />
          </button>
          <button
            class="sidebar-search-toggle"
            type="button"
            :aria-pressed="isSidebarSearchVisible"
            aria-label="Search threads"
            title="Search threads"
            @click="toggleSidebarSearch"
          >
            <IconTablerSearch class="sidebar-search-toggle-icon" />
          </button>
        </SidebarThreadControls>

        <div v-if="!isSidebarCollapsed && isSidebarSearchVisible" class="sidebar-search-bar">
          <IconTablerSearch class="sidebar-search-bar-icon" />
          <input
            id="codex-sidebar-thread-filter"
            ref="sidebarSearchInputRef"
            v-model="sidebarSearchQuery"
            class="sidebar-search-input"
            type="search"
            name="codex-sidebar-thread-filter"
            placeholder="Filter threads..."
            autocomplete="off"
            @keydown="onSidebarSearchKeydown"
          />
          <button
            v-if="sidebarSearchQuery.length > 0"
            class="sidebar-search-clear"
            type="button"
            aria-label="Clear search"
            @click="clearSidebarSearch"
          >
            <IconTablerX class="sidebar-search-clear-icon" />
          </button>
        </div>

        <SidebarThreadTree
          v-if="!isSidebarCollapsed"
          class="sidebar-thread-tree-host"
          :theme="themeName"
          :groups="projectGroups"
          :project-display-name-by-id="projectDisplayNameById"
          :selected-thread-id="selectedThreadId" :is-loading="isLoadingThreads"
          :search-query="sidebarSearchQuery"
          @select="onSelectThread"
          @archive="onArchiveThread" @rename-thread="onRenameThread"
          @mark-thread-unread="onMarkThreadUnread" @mark-thread-read="onMarkThreadRead"
          @start-new-thread="onStartNewThread" @rename-project="onRenameProject"
          @remove-project="onRemoveProject" @reorder-project="onReorderProject" />

        <SidebarRateLimitMeters
          v-if="!isSidebarCollapsed"
          :rate-limits="accountRateLimits"
          :is-loading="isLoadingRateLimits"
          :error="accountRateLimitsError"
        />
      </section>
    </template>

    <template #content>
      <section class="content-root">
        <ContentHeader :title="contentTitle">
          <template v-if="!isHomeRoute" #actions>
            <GitStatusIndicator
              :status="selectedThreadGitStatus"
              :is-loading="selectedThreadGitStatusLoading"
            />
          </template>
          <template #leading>
            <SidebarThreadControls
              v-if="isSidebarCollapsed"
              class="sidebar-thread-controls-header-host"
              :is-sidebar-collapsed="isSidebarCollapsed"
              :is-auto-refresh-enabled="isAutoRefreshEnabled"
              :auto-refresh-button-label="autoRefreshButtonLabel"
              :show-new-thread-button="true"
              @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
              @toggle-auto-refresh="onToggleAutoRefreshTimer"
              @start-new-thread="onStartNewThreadFromToolbar"
            >
              <button
                class="theme-toggle-button"
                type="button"
                :aria-pressed="isDarkMode"
                :aria-label="themeToggleLabel"
                :title="themeToggleLabel"
                @click="toggleDarkMode"
              >
                <IconTablerSun v-if="isDarkMode" class="theme-toggle-icon" />
                <IconTablerMoon v-else class="theme-toggle-icon" />
              </button>
            </SidebarThreadControls>
          </template>
        </ContentHeader>

        <section class="content-body">
          <template v-if="isHomeRoute">
            <div class="content-grid">
              <div class="new-thread-empty">
                <p class="new-thread-hero">Let's build</p>
                <ComposerDropdown
                  class="new-thread-folder-dropdown"
                  :model-value="newThreadCwd"
                  :options="newThreadFolderOptions"
                  placeholder="Choose folder"
                  searchable
                  search-placeholder="Search projects"
                  add-option-label="Add new project"
                  add-option-placeholder="Project path"
                  directory-picker
                  @update:model-value="onSelectNewThreadFolder"
                  @add-option="onAddNewThreadProject"
                  @request-directory-picker="newThreadDirectoryPickerOpen = true"
                />
              </div>

              <ThreadComposer :active-thread-id="composerThreadContextId" :disabled="isSendingMessage"
                :models="availableModelIds" :selected-model="selectedModelId"
                :selected-reasoning-effort="selectedReasoningEffort" :is-turn-in-progress="false"
                :context-usage-percent="null"
                :is-interrupting-turn="false"
                :show-permission-mode="false"
                @submit="onSubmitThreadMessage"
                @update:selected-model="onSelectModel" @update:selected-reasoning-effort="onSelectReasoningEffort" />
            </div>
          </template>
          <template v-else>
            <div class="content-grid">
              <div class="content-thread">
                <ThreadConversation :key="composerThreadContextId" :messages="filteredMessages" :is-loading="isLoadingMessages"
                  :active-thread-id="composerThreadContextId" :scroll-state="selectedThreadScrollState"
                  :working-directory="selectedThread?.cwd ?? ''"
                  :live-overlay="liveOverlay"
                  :pending-requests="selectedNonApprovalServerRequests"
                  @update-scroll-state="onUpdateThreadScrollState"
                  @respond-server-request="onRespondServerRequest" />
              </div>

              <ThreadComposer :active-thread-id="composerThreadContextId"
                :disabled="isSendingMessage || isLoadingMessages" :models="availableModelIds"
                :selected-model="selectedModelId" :selected-reasoning-effort="selectedReasoningEffort"
                :permission-mode="selectedThreadPermissionMode"
                :show-permission-mode="true"
                :context-usage-percent="selectedContextUsagePercent"
                :is-turn-in-progress="isSelectedThreadInProgress" :is-interrupting-turn="isInterruptingTurn"
                @submit="onSubmitThreadMessage" @update:selected-model="onSelectModel"
                @update:selected-reasoning-effort="onSelectReasoningEffort"
                @update:permission-mode="onPermissionMode"
                @interrupt="onInterruptTurn" />
            </div>
          </template>
        </section>

        <ApprovalRequestsPanel
          :requests="pendingApprovalRequests"
          @respond-server-request="onRespondServerRequest"
        />
      </section>
    </template>
  </DesktopLayout>

  <DirectoryPickerOverlay
    :open="newThreadDirectoryPickerOpen"
    :theme="themeName"
    @close="newThreadDirectoryPickerOpen = false"
    @confirm="onConfirmNewThreadDirectory"
  />

  <FullAccessRiskModal
    :open="fullAccessRiskModalOpen"
    :theme="themeName"
    @confirm="confirmFullAccessRiskAndSend"
    @cancel="cancelFullAccessRiskModal"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DesktopLayout from './components/layout/DesktopLayout.vue'
import SidebarThreadTree from './components/sidebar/SidebarThreadTree.vue'
import ContentHeader from './components/content/ContentHeader.vue'
import ThreadConversation from './components/content/ThreadConversation.vue'
import ThreadComposer from './components/content/ThreadComposer.vue'
import ApprovalRequestsPanel from './components/content/ApprovalRequestsPanel.vue'
import ComposerDropdown from './components/content/ComposerDropdown.vue'
import DirectoryPickerOverlay from './components/content/DirectoryPickerOverlay.vue'
import FullAccessRiskModal from './components/content/FullAccessRiskModal.vue'
import SidebarThreadControls from './components/sidebar/SidebarThreadControls.vue'
import SidebarRateLimitMeters from './components/sidebar/SidebarRateLimitMeters.vue'
import GitStatusIndicator from './components/content/GitStatusIndicator.vue'
import IconTablerSearch from './components/icons/IconTablerSearch.vue'
import IconTablerMoon from './components/icons/IconTablerMoon.vue'
import IconTablerSun from './components/icons/IconTablerSun.vue'
import IconTablerX from './components/icons/IconTablerX.vue'
import { useDesktopState } from './composables/useDesktopState'
import type {
  ReasoningEffort,
  ThreadPermissionMode,
  ThreadScrollState,
  UiComposerDraft,
  UiServerRequest,
  UiServerRequestReply,
} from './types/codex'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'codex-web-local.sidebar-collapsed.v1'
const DARK_MODE_STORAGE_KEY = 'codex-web-local.dark-mode.v1'

function loadDarkMode(): boolean {
  if (typeof window === 'undefined') return false

  const saved = window.localStorage.getItem(DARK_MODE_STORAGE_KEY)
  if (saved === '1') return true
  if (saved === '0') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const {
  projectGroups,
  projectDisplayNameById,
  selectedThread,
  selectedThreadScrollState,
  selectedThreadServerRequests,
  pendingApprovalRequests,
  selectedLiveOverlay,
  selectedThreadId,
  availableModelIds,
  selectedModelId,
  selectedReasoningEffort,
  selectedContextUsagePercent,
  selectedThreadGitStatus,
  selectedThreadGitStatusLoading,
  accountRateLimits,
  accountRateLimitsError,
  messages,
  isLoadingThreads,
  isLoadingMessages,
  isSendingMessage,
  isInterruptingTurn,
  isLoadingRateLimits,
  isAutoRefreshEnabled,
  autoRefreshSecondsLeft,
  refreshAll,
  selectThread,
  setThreadScrollState,
  archiveThreadById,
  sendMessageToSelectedThread,
  sendMessageToNewThread,
  interruptSelectedThreadTurn,
  setSelectedModelId,
  setSelectedReasoningEffort,
  selectedThreadPermissionMode,
  setThreadPermissionMode,
  fullAccessRiskModalOpen,
  confirmFullAccessRiskAndSend,
  cancelFullAccessRiskModal,
  respondToPendingServerRequest,
  renameProject,
  renameThreadById,
  markThreadUnreadById,
  markThreadReadById,
  removeProject,
  reorderProject,
  getProjectFolderCwd,
  toggleAutoRefreshTimer,
  startPolling,
  stopPolling,
} = useDesktopState()

const route = useRoute()
const router = useRouter()
const isRouteSyncInProgress = ref(false)
const hasInitialized = ref(false)
const newThreadCwd = ref('')
const newThreadCustomProjectOptions = ref<Array<{ value: string; label: string }>>([])
const newThreadDirectoryPickerOpen = ref(false)
const isSidebarCollapsed = ref(loadSidebarCollapsed())
const isDarkMode = ref(loadDarkMode())
const sidebarSearchQuery = ref('')
const isSidebarSearchVisible = ref(false)
const sidebarSearchInputRef = ref<HTMLInputElement | null>(null)

const routeThreadId = computed(() => {
  const rawThreadId = route.params.threadId
  return typeof rawThreadId === 'string' ? rawThreadId : ''
})

const knownThreadIdSet = computed(() => {
  const ids = new Set<string>()
  for (const group of projectGroups.value) {
    for (const thread of group.threads) {
      ids.add(thread.id)
    }
  }
  return ids
})

const isHomeRoute = computed(() => route.name === 'home')
const themeName = computed(() => (isDarkMode.value ? 'dark' : 'light'))
const themeToggleLabel = computed(() => (isDarkMode.value ? 'Switch to light mode' : 'Switch to dark mode'))
const contentTitle = computed(() => {
  if (isHomeRoute.value) return 'New thread'
  return selectedThread.value?.title ?? 'Choose a thread'
})
const autoRefreshButtonLabel = computed(() =>
  isAutoRefreshEnabled.value
    ? `Auto refresh in ${String(autoRefreshSecondsLeft.value)}s`
    : 'Enable 4s refresh',
)
const filteredMessages = computed(() =>
  messages.value.filter((message) => {
    const type = normalizeMessageType(message.messageType, message.role)
    if (type === 'worked') return true
    if (type === 'turnActivity.live' || type === 'turnError.live' || type === 'agentReasoning.live') return false
    return true
  }),
)
const liveOverlay = computed(() => selectedLiveOverlay.value)
const selectedNonApprovalServerRequests = computed(() =>
  selectedThreadServerRequests.value.filter((request) => !isApprovalRequest(request)),
)
const composerThreadContextId = computed(() => (isHomeRoute.value ? '__new-thread__' : selectedThreadId.value))
const isSelectedThreadInProgress = computed(() => !isHomeRoute.value && selectedThread.value?.inProgress === true)
const newThreadFolderOptions = computed(() => {
  const options: Array<{ value: string; label: string }> = []
  const seenCwds = new Set<string>()

  for (const group of projectGroups.value) {
    const cwd = getProjectFolderCwd(group.projectName).trim()
    if (!cwd || seenCwds.has(cwd)) continue
    seenCwds.add(cwd)
    options.push({
      value: cwd,
      label: projectDisplayNameById.value[group.projectName] ?? group.projectName,
    })
  }

  for (const option of newThreadCustomProjectOptions.value) {
    if (seenCwds.has(option.value)) continue
    seenCwds.add(option.value)
    options.push(option)
  }

  return options
})

onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDown)
  void initialize()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeyDown)
  stopPolling()
})

function toggleSidebarSearch(): void {
  isSidebarSearchVisible.value = !isSidebarSearchVisible.value
  if (isSidebarSearchVisible.value) {
    nextTick(() => sidebarSearchInputRef.value?.focus())
  } else {
    sidebarSearchQuery.value = ''
  }
}

function clearSidebarSearch(): void {
  sidebarSearchQuery.value = ''
  sidebarSearchInputRef.value?.focus()
}

function onSidebarSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    isSidebarSearchVisible.value = false
    sidebarSearchQuery.value = ''
  }
}

function onSelectThread(threadId: string): void {
  if (!threadId) return
  if (route.name === 'thread' && routeThreadId.value === threadId) return
  void router.push({ name: 'thread', params: { threadId } })
}

function onArchiveThread(threadId: string): void {
  void archiveThreadById(threadId)
}

function onRenameThread(payload: { threadId: string; title: string }): void {
  void renameThreadById(payload.threadId, payload.title)
}

function onMarkThreadUnread(threadId: string): void {
  markThreadUnreadById(threadId)
}

function onMarkThreadRead(threadId: string): void {
  markThreadReadById(threadId)
}

function onStartNewThread(projectName: string): void {
  const projectCwd = getProjectFolderCwd(projectName)
  if (projectCwd) {
    onAddNewThreadProject(projectCwd)
  }
  if (isHomeRoute.value) return
  void router.push({ name: 'home' })
}

function onStartNewThreadFromToolbar(): void {
  const cwd = selectedThread.value?.cwd?.trim() ?? ''
  if (cwd) {
    onAddNewThreadProject(cwd)
  }
  if (isHomeRoute.value) return
  void router.push({ name: 'home' })
}

function onRenameProject(payload: { projectName: string; displayName: string }): void {
  renameProject(payload.projectName, payload.displayName)
}

function onRemoveProject(projectName: string): void {
  removeProject(projectName)
}

function onReorderProject(payload: { projectName: string; toIndex: number }): void {
  reorderProject(payload.projectName, payload.toIndex)
}

function onUpdateThreadScrollState(payload: { threadId: string; state: ThreadScrollState }): void {
  setThreadScrollState(payload.threadId, payload.state)
}

function isApprovalRequest(request: UiServerRequest): boolean {
  return request.method === 'item/commandExecution/requestApproval' ||
    request.method === 'item/fileChange/requestApproval' ||
    request.method === 'execCommandApproval' ||
    request.method === 'applyPatchApproval'
}

function onRespondServerRequest(payload: UiServerRequestReply): void {
  void respondToPendingServerRequest(payload)
}

function onToggleAutoRefreshTimer(): void {
  toggleAutoRefreshTimer()
}

function setSidebarCollapsed(nextValue: boolean): void {
  if (isSidebarCollapsed.value === nextValue) return
  isSidebarCollapsed.value = nextValue
  saveSidebarCollapsed(nextValue)
}

function toggleDarkMode(): void {
  isDarkMode.value = !isDarkMode.value
  window.localStorage.setItem(DARK_MODE_STORAGE_KEY, isDarkMode.value ? '1' : '0')
}

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (!event.ctrlKey && !event.metaKey) return
  if (event.shiftKey || event.altKey) return
  if (event.key.toLowerCase() !== 'b') return
  event.preventDefault()
  setSidebarCollapsed(!isSidebarCollapsed.value)
}

function onSubmitThreadMessage(draft: UiComposerDraft): void {
  if (isHomeRoute.value) {
    void submitFirstMessageForNewThread(draft)
    return
  }
  void sendMessageToSelectedThread(draft)
}

function onSelectNewThreadFolder(cwd: string): void {
  newThreadCwd.value = cwd.trim()
}

function getProjectLabelFromCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const name = normalized.split('/').filter(Boolean).pop()
  return name || cwd
}

function onAddNewThreadProject(cwd: string): void {
  const normalizedCwd = cwd.trim()
  if (!normalizedCwd) return

  const exists = newThreadFolderOptions.value.some((option) => option.value === normalizedCwd)
  if (!exists) {
    newThreadCustomProjectOptions.value = [
      ...newThreadCustomProjectOptions.value,
      {
        value: normalizedCwd,
        label: getProjectLabelFromCwd(normalizedCwd),
      },
    ]
  }
  newThreadCwd.value = normalizedCwd
}

function onConfirmNewThreadDirectory(cwd: string): void {
  onAddNewThreadProject(cwd)
  newThreadDirectoryPickerOpen.value = false
}

function onSelectModel(modelId: string): void {
  setSelectedModelId(modelId)
}

function onSelectReasoningEffort(effort: ReasoningEffort | ''): void {
  setSelectedReasoningEffort(effort)
}

function onPermissionMode(mode: ThreadPermissionMode): void {
  setThreadPermissionMode(selectedThreadId.value, mode)
}

function onInterruptTurn(): void {
  void interruptSelectedThreadTurn()
}

function loadSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
}

function saveSidebarCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? '1' : '0')
}

function normalizeMessageType(rawType: string | undefined, role: string): string {
  const normalized = (rawType ?? '').trim()
  if (normalized.length > 0) {
    return normalized
  }
  return role.trim() || 'message'
}

async function initialize(): Promise<void> {
  await refreshAll()
  hasInitialized.value = true
  await syncThreadSelectionWithRoute()
  startPolling()
}

async function syncThreadSelectionWithRoute(): Promise<void> {
  if (isRouteSyncInProgress.value) return
  isRouteSyncInProgress.value = true

  try {
    if (route.name === 'home') {
      if (selectedThreadId.value !== '') {
        await selectThread('')
      }
      return
    }

    if (route.name === 'thread') {
      const threadId = routeThreadId.value
      if (!threadId) return

      if (!knownThreadIdSet.value.has(threadId)) {
        await router.replace({ name: 'home' })
        return
      }

      if (selectedThreadId.value !== threadId) {
        await selectThread(threadId)
      }
      return
    }

  } finally {
    isRouteSyncInProgress.value = false
  }
}

watch(
  () =>
    [
      route.name,
      routeThreadId.value,
      isLoadingThreads.value,
      knownThreadIdSet.value.has(routeThreadId.value),
      selectedThreadId.value,
    ] as const,
  async () => {
    if (!hasInitialized.value) return
    await syncThreadSelectionWithRoute()
  },
)

watch(
  () => selectedThreadId.value,
  async (threadId) => {
    if (!hasInitialized.value) return
    if (isRouteSyncInProgress.value) return
    if (isHomeRoute.value) return

    if (!threadId) {
      if (route.name !== 'home') {
        await router.replace({ name: 'home' })
      }
      return
    }

    if (route.name === 'thread' && routeThreadId.value === threadId) return
    await router.replace({ name: 'thread', params: { threadId } })
  },
)

watch(
  () => newThreadFolderOptions.value,
  (options) => {
    if (options.length === 0) {
      newThreadCwd.value = ''
      return
    }
    const hasSelected = options.some((option) => option.value === newThreadCwd.value)
    if (!hasSelected) {
      newThreadCwd.value = options[0].value
    }
  },
  { immediate: true },
)

async function submitFirstMessageForNewThread(draft: UiComposerDraft): Promise<void> {
  try {
    const threadId = await sendMessageToNewThread(draft, newThreadCwd.value)
    if (!threadId) return
    await router.replace({ name: 'thread', params: { threadId } })
  } catch {
    // Error is already reflected in state.
  }
}
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-root {
  @apply h-full min-h-full py-4 px-2 flex flex-col gap-2 overflow-hidden select-none;
}

.sidebar-root input,
.sidebar-root textarea {
  @apply select-text;
}

.content-root {
  @apply h-full min-h-0 w-full min-w-0 flex flex-col overflow-y-hidden overflow-x-auto bg-white;
}

.sidebar-thread-controls-host {
  @apply mt-1 -translate-y-px px-2 pb-1;
}

.sidebar-search-toggle {
  @apply h-6.75 w-6.75 rounded-md border border-transparent bg-transparent text-zinc-600 flex items-center justify-center transition hover:border-zinc-200 hover:bg-zinc-50;
}

.theme-toggle-button {
  @apply h-6.75 w-6.75 rounded-md border border-transparent bg-transparent text-zinc-600 flex items-center justify-center transition hover:border-zinc-200 hover:bg-zinc-50;
}

.theme-toggle-button[aria-pressed='true'] {
  @apply border-zinc-300 bg-zinc-100 text-zinc-700;
}

.theme-toggle-icon {
  @apply w-4 h-4;
}

.sidebar-search-toggle[aria-pressed='true'] {
  @apply border-zinc-300 bg-zinc-100 text-zinc-700;
}

.sidebar-search-toggle-icon {
  @apply w-4 h-4;
}

.sidebar-search-bar {
  @apply flex items-center gap-1.5 mx-2 px-2 py-1 rounded-md border border-zinc-200 bg-white transition-colors focus-within:border-zinc-400;
}

.sidebar-search-bar-icon {
  @apply w-3.5 h-3.5 text-zinc-400 shrink-0;
}

.sidebar-search-input {
  @apply flex-1 min-w-0 bg-transparent text-sm text-zinc-800 placeholder-zinc-400 outline-none border-none p-0;
}

.sidebar-search-clear {
  @apply w-4 h-4 rounded text-zinc-400 flex items-center justify-center transition hover:text-zinc-600;
}

.sidebar-search-clear-icon {
  @apply w-3.5 h-3.5;
}

.sidebar-thread-tree-host {
  @apply flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden;
}

.sidebar-thread-controls-header-host {
  @apply ml-1;
}

.content-body {
  @apply flex-1 min-h-0 w-full min-w-0 flex flex-col gap-3 overflow-y-hidden overflow-x-auto pt-1;
  padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px));
}

.content-error {
  @apply m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700;
}

.content-grid {
  @apply flex-1 min-h-0 min-w-0 flex flex-col gap-3;
}

.content-thread {
  @apply flex-1 min-h-0 min-w-0;
}

.new-thread-empty {
  @apply flex-1 min-h-0 flex flex-col items-center justify-center gap-0.5 px-6;
}

.new-thread-hero {
  @apply m-0 text-[2.5rem] font-normal leading-[1.05] text-zinc-900;
}

.new-thread-folder-dropdown {
  @apply text-[2.5rem] text-zinc-500;
}

.new-thread-folder-dropdown :deep(.composer-dropdown-trigger) {
  @apply h-auto text-[2.5rem] leading-[1.05];
}

.new-thread-folder-dropdown :deep(.composer-dropdown-value) {
  @apply leading-[1.05];
}

.new-thread-folder-dropdown :deep(.composer-dropdown-chevron) {
  @apply h-5 w-5 mt-0;
}

</style>
