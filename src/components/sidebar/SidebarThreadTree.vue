<template>
  <section class="thread-tree-root">
    <section v-if="pinnedThreads.length > 0" class="pinned-section">
      <ul class="thread-list">
        <li v-for="thread in pinnedThreads" :key="thread.id" class="thread-row-item">
          <SidebarMenuRow
            class="thread-row"
            :data-active="thread.id === selectedThreadId"
            :data-pinned="isPinned(thread.id)"
            :force-right-hover="isThreadMenuOpen(thread.id)"
            @contextmenu.prevent="onThreadContextMenu($event, thread)"
            @mouseleave="onThreadRowLeave(thread.id)"
          >
            <template #left>
              <span class="thread-left-stack">
                <span v-if="thread.inProgress || thread.unread" class="thread-status-indicator" :data-state="getThreadState(thread)" />
                <button class="thread-pin-button" type="button" title="pin" @click.stop="togglePin(thread.id)">
                  <IconTablerPin class="thread-icon" />
                </button>
              </span>
            </template>
            <button class="thread-main-button" type="button" @click="onSelect(thread.id)">
              <span class="thread-row-title">{{ thread.title }}</span>
            </button>
            <template #right>
              <span class="thread-row-time">{{ formatRelative(thread.createdAtIso || thread.updatedAtIso) }}</span>
            </template>
            <template #right-hover>
              <button
                class="thread-archive-button"
                :data-confirm="archiveConfirmThreadId === thread.id"
                type="button"
                title="archive_thread"
                @click="onArchiveClick(thread.id)"
              >
                <span v-if="archiveConfirmThreadId === thread.id">confirm</span>
                <IconTablerArchive v-else class="thread-icon" />
              </button>
            </template>
          </SidebarMenuRow>
        </li>
      </ul>
    </section>

    <SidebarMenuRow as="header" class="thread-tree-header-row">
      <span class="thread-tree-header">Threads</span>
    </SidebarMenuRow>

    <div ref="threadTreeScrollRef" class="thread-tree-scroll codex-subtle-scroll">
      <p v-if="isSearchActive && filteredGroups.length === 0" class="thread-tree-no-results">No matching threads</p>

      <p v-else-if="isLoading && groups.length === 0" class="thread-tree-loading">Loading threads...</p>

      <div v-else ref="groupsContainerRef" class="thread-tree-groups" :style="groupsContainerStyle">
      <article
        v-for="group in filteredGroups"
        :key="group.projectName"
        :ref="(el) => setProjectGroupRef(group.projectName, el)"
        class="project-group"
        :data-project-name="group.projectName"
        :data-expanded="!isCollapsed(group.projectName)"
        :data-dragging="isDraggingProject(group.projectName)"
        :style="projectGroupStyle(group.projectName)"
      >
          <SidebarMenuRow
            as="div"
            class="project-header-row"
            :force-right-hover="isProjectMenuOpen(group.projectName)"
            role="button"
            tabindex="0"
            @click="toggleProjectCollapse(group.projectName)"
            @keydown.enter.prevent="toggleProjectCollapse(group.projectName)"
            @keydown.space.prevent="toggleProjectCollapse(group.projectName)"
          >
            <template #left>
              <span class="project-icon-stack">
                <span class="project-icon-folder">
                  <IconTablerFolder v-if="isCollapsed(group.projectName)" class="thread-icon" />
                  <IconTablerFolderOpen v-else class="thread-icon" />
                </span>
                <span class="project-icon-chevron">
                  <IconTablerChevronRight v-if="isCollapsed(group.projectName)" class="thread-icon" />
                  <IconTablerChevronDown v-else class="thread-icon" />
                </span>
              </span>
            </template>
            <span
              class="project-main-button"
              :data-dragging-handle="isDraggingProject(group.projectName)"
              @mousedown.left="onProjectHandleMouseDown($event, group.projectName)"
            >
              <span class="project-title">{{ getProjectDisplayName(group.projectName) }}</span>
            </span>
            <template #right-hover>
              <div class="project-hover-controls">
                <div :ref="(el) => setProjectMenuWrapRef(group.projectName, el)" class="project-menu-wrap">
                  <button
                    class="project-menu-trigger"
                    type="button"
                    title="project_menu"
                    @click.stop="toggleProjectMenu(group.projectName)"
                  >
                    <IconTablerDots class="thread-icon" />
                  </button>
                </div>

                <button
                  class="thread-start-button"
                  type="button"
                  :aria-label="getNewThreadButtonAriaLabel(group.projectName)"
                  :title="getNewThreadButtonAriaLabel(group.projectName)"
                  @click.stop="onStartNewThread(group.projectName)"
                >
                  <IconTablerFilePencil class="thread-icon" />
                </button>
              </div>
            </template>
          </SidebarMenuRow>

          <ul v-if="visibleThreads(group).length > 0" class="thread-list">
            <li v-for="thread in visibleThreads(group)" :key="thread.id" class="thread-row-item">
              <SidebarMenuRow
                class="thread-row"
                :data-active="thread.id === selectedThreadId"
                :data-pinned="isPinned(thread.id)"
                :force-right-hover="isThreadMenuOpen(thread.id)"
                @contextmenu.prevent="onThreadContextMenu($event, thread)"
                @mouseleave="onThreadRowLeave(thread.id)"
              >
                <template #left>
                  <span class="thread-left-stack">
                    <span
                      v-if="thread.inProgress || thread.unread"
                      class="thread-status-indicator"
                      :data-state="getThreadState(thread)"
                    />
                    <button class="thread-pin-button" type="button" title="pin" @click.stop="togglePin(thread.id)">
                      <IconTablerPin class="thread-icon" />
                    </button>
                  </span>
                </template>
                <button class="thread-main-button" type="button" @click="onSelect(thread.id)">
                  <span class="thread-row-title">{{ thread.title }}</span>
                </button>
                <template #right>
                  <span class="thread-row-time">{{ formatRelative(thread.createdAtIso || thread.updatedAtIso) }}</span>
                </template>
                <template #right-hover>
                  <button
                    class="thread-archive-button"
                    :data-confirm="archiveConfirmThreadId === thread.id"
                    type="button"
                    title="archive_thread"
                    @click="onArchiveClick(thread.id)"
                  >
                    <span v-if="archiveConfirmThreadId === thread.id">confirm</span>
                    <IconTablerArchive v-else class="thread-icon" />
                  </button>
                </template>
              </SidebarMenuRow>
            </li>
          </ul>

          <SidebarMenuRow
            v-else-if="!isCollapsed(group.projectName) && !hasThreads(group)"
            as="p"
            class="project-empty-row"
          >
            <template #left>
              <span class="project-empty-spacer" />
            </template>
            <span class="project-empty">No threads</span>
          </SidebarMenuRow>

          <SidebarMenuRow v-if="hasHiddenThreads(group)" class="thread-show-more-row">
            <template #left>
              <span class="thread-show-more-spacer" />
            </template>
            <button class="thread-show-more-button" type="button" @click="toggleProjectExpansion(group.projectName)">
              {{ isExpanded(group.projectName) ? 'Show less' : 'Show more' }}
            </button>
          </SidebarMenuRow>
      </article>
    </div>
    </div>

    <div
      v-if="openThreadMenu"
      ref="threadMenuPanelRef"
      class="thread-context-menu"
      :style="threadMenuStyle"
      @click.stop
      @contextmenu.prevent.stop
    >
      <template v-if="openThreadMenu.mode === 'actions'">
        <button class="thread-context-menu-item" type="button" @click="onThreadMenuTogglePin">
          {{ openThreadMenuThread && isPinned(openThreadMenuThread.id) ? 'Unpin chat' : 'Pin chat' }}
        </button>
        <button class="thread-context-menu-item" type="button" @click="openThreadRenameMenu">
          Rename chat
        </button>
        <button class="thread-context-menu-item" type="button" @click="onThreadMenuArchive">
          Archive chat
        </button>
        <button class="thread-context-menu-item" type="button" @click="onThreadMenuToggleUnread">
          {{ openThreadMenuThread?.unread ? 'Mark as read' : 'Mark as unread' }}
        </button>
      </template>
      <form v-else class="thread-context-rename-form" @submit.prevent="submitThreadRename">
        <label class="thread-context-menu-label" for="thread-rename-input">Chat name</label>
        <input
          id="thread-rename-input"
          ref="threadRenameInputRef"
          v-model="threadRenameDraft"
          class="thread-context-menu-input"
          type="text"
          @keydown.escape.prevent="closeThreadMenu"
        />
        <div class="thread-context-menu-actions">
          <button class="thread-context-menu-item" type="submit">Save</button>
          <button class="thread-context-menu-item" type="button" @click="closeThreadMenu">Cancel</button>
        </div>
      </form>
    </div>

    <Teleport to="body">
      <div v-if="openProjectMenuId" :data-theme="props.theme" class="project-menu-teleport-root">
        <div
          ref="projectMenuPanelRef"
          class="project-menu-panel"
          :style="projectMenuFixedStyle"
          @click.stop
        >
          <template v-if="projectMenuMode === 'actions'">
            <button class="project-menu-item" type="button" @click="openRenameProjectMenu(openProjectMenuId)">
              Edit name
            </button>
            <button
              class="project-menu-item project-menu-item-danger"
              type="button"
              @click="onRemoveProject(openProjectMenuId)"
            >
              Remove
            </button>
          </template>
          <template v-else>
            <label class="project-menu-label">Project name</label>
            <input
              v-model="projectRenameDraft"
              class="project-menu-input"
              type="text"
              @input="onProjectNameInput(openProjectMenuId)"
            />
          </template>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { getChatState, patchChatState, updatePinnedThreadIds } from '../../api/codexGateway'
import type { UiProjectGroup, UiThread } from '../../types/codex'
import IconTablerArchive from '../icons/IconTablerArchive.vue'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import IconTablerDots from '../icons/IconTablerDots.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerFolderOpen from '../icons/IconTablerFolderOpen.vue'
import IconTablerPin from '../icons/IconTablerPin.vue'
import SidebarMenuRow from './SidebarMenuRow.vue'

const props = withDefaults(
  defineProps<{
    groups: UiProjectGroup[]
    projectDisplayNameById: Record<string, string>
    selectedThreadId: string
    isLoading: boolean
    searchQuery: string
    /** Mirrors app shell theme so teleported menus match `style.css` [data-theme] rules. */
    theme?: 'dark' | 'light'
  }>(),
  {
    theme: 'light',
  },
)

const emit = defineEmits<{
  select: [threadId: string]
  archive: [threadId: string]
  'rename-thread': [payload: { threadId: string; title: string }]
  'mark-thread-unread': [threadId: string]
  'mark-thread-read': [threadId: string]
  'start-new-thread': [projectName: string]
  'rename-project': [payload: { projectName: string; displayName: string }]
  'remove-project': [projectName: string]
  'reorder-project': [payload: { projectName: string; toIndex: number }]
}>()

type PendingProjectDrag = {
  projectName: string
  fromIndex: number
  startClientX: number
  startClientY: number
  pointerOffsetY: number
  groupLeft: number
  groupWidth: number
  groupHeight: number
  groupOuterHeight: number
}

type ActiveProjectDrag = {
  projectName: string
  fromIndex: number
  pointerOffsetY: number
  groupLeft: number
  groupWidth: number
  groupHeight: number
  groupOuterHeight: number
  ghostTop: number
  dropTargetIndexFull: number | null
}

type DragPointerSample = {
  clientX: number
  clientY: number
}

type ThreadMenuState = {
  threadId: string
  x: number
  y: number
  mode: 'actions' | 'rename'
}

const DRAG_START_THRESHOLD_PX = 4
const PROJECT_GROUP_EXPANDED_GAP_PX = 6
const PINNED_THREADS_STORAGE_KEY = 'codex-web-local.pinned-threads.v1'
const THREAD_MENU_WIDTH_PX = 220
const THREAD_MENU_MAX_HEIGHT_PX = 240
const PROJECT_MENU_ANCHOR_GAP_PX = 4
const expandedProjects = ref<Record<string, boolean>>({})
const collapsedProjects = ref<Record<string, boolean>>({})
const pinnedThreadIds = ref<string[]>([])
const archiveConfirmThreadId = ref('')
const openProjectMenuId = ref('')
const openThreadMenu = ref<ThreadMenuState | null>(null)
const projectMenuMode = ref<'actions' | 'rename'>('actions')
const projectRenameDraft = ref('')
const threadRenameDraft = ref('')
const projectMenuPanelPosition = ref({ top: 0, left: 0 })
const projectMenuFixedStyle = computed(() => ({
  top: `${projectMenuPanelPosition.value.top}px`,
  left: `${projectMenuPanelPosition.value.left}px`,
}))
const groupsContainerRef = ref<HTMLElement | null>(null)
const threadTreeScrollRef = ref<HTMLElement | null>(null)
const projectMenuPanelRef = ref<HTMLElement | null>(null)
const threadMenuPanelRef = ref<HTMLElement | null>(null)
const threadRenameInputRef = ref<HTMLInputElement | null>(null)
const pendingProjectDrag = ref<PendingProjectDrag | null>(null)
const activeProjectDrag = ref<ActiveProjectDrag | null>(null)
let pendingDragPointerSample: DragPointerSample | null = null
let dragPointerRafId: number | null = null
let projectMenuScrollParent: HTMLElement | null = null
const suppressNextProjectToggleId = ref('')
const measuredHeightByProject = ref<Record<string, number>>({})
const projectGroupElementByName = new Map<string, HTMLElement>()
const projectMenuWrapElementByName = new Map<string, HTMLElement>()
const projectNameByElement = new WeakMap<HTMLElement, string>()
const projectGroupResizeObserver =
  typeof window !== 'undefined'
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement
          const projectName = projectNameByElement.get(element)
          if (!projectName) continue
          updateMeasuredProjectHeight(projectName, element)
        }
      })
    : null
const COLLAPSED_STORAGE_KEY = 'codex-web-local.collapsed-projects.v1'

function loadCollapsedState(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, boolean>
  } catch {
    return {}
  }
}

function loadPinnedThreadIds(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(PINNED_THREADS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const threadIds: string[] = []
    for (const item of parsed) {
      if (typeof item === 'string' && item.length > 0 && !threadIds.includes(item)) {
        threadIds.push(item)
      }
    }
    return threadIds
  } catch {
    return []
  }
}

function normalizePinnedThreadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const threadIds: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = item.trim()
    if (!normalized || threadIds.includes(normalized)) continue
    threadIds.push(normalized)
  }
  return threadIds
}

function normalizeCollapsedProjectsRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record: Record<string, boolean> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (raw === true) {
      record[key] = true
    } else if (raw === false) {
      record[key] = false
    }
  }
  return record
}

collapsedProjects.value = loadCollapsedState()
pinnedThreadIds.value = loadPinnedThreadIds()
const isApplyingRemotePinnedState = ref(false)
const isApplyingRemoteCollapsedState = ref(false)
let lastPinnedStateSerialized = JSON.stringify(pinnedThreadIds.value)
let lastCollapsedSerialized = JSON.stringify(collapsedProjects.value)
let pinnedSyncRequestId = 0
let collapsedSyncRequestId = 0

async function syncPinnedThreadIdsToServer(nextIds: string[]): Promise<void> {
  const requestId = ++pinnedSyncRequestId
  try {
    const saved = await updatePinnedThreadIds(nextIds)
    if (requestId !== pinnedSyncRequestId) return
    const normalized = normalizePinnedThreadIds(saved.pinnedThreadIds)
    isApplyingRemotePinnedState.value = true
    pinnedThreadIds.value = normalized
    lastPinnedStateSerialized = JSON.stringify(normalized)
  } catch {
    // Keep local state if sync fails; user can continue pin/unpin without blocking.
  } finally {
    isApplyingRemotePinnedState.value = false
  }
}

async function syncCollapsedProjectsToServer(next: Record<string, boolean>): Promise<void> {
  const requestId = ++collapsedSyncRequestId
  try {
    const saved = await patchChatState({ collapsedProjects: next })
    if (requestId !== collapsedSyncRequestId) return
    const applied = normalizeCollapsedProjectsRecord(saved.collapsedProjects)
    isApplyingRemoteCollapsedState.value = true
    collapsedProjects.value = applied
    lastCollapsedSerialized = JSON.stringify(applied)
  } catch {
    // Keep local state if sync fails.
  } finally {
    isApplyingRemoteCollapsedState.value = false
  }
}

onMounted(async () => {
  const localPinned = [...pinnedThreadIds.value]
  const localCollapsed = { ...collapsedProjects.value }
  try {
    const chatState = await getChatState()
    const remotePinned = normalizePinnedThreadIds(chatState.pinnedThreadIds)
    const remoteCollapsed = normalizeCollapsedProjectsRecord(chatState.collapsedProjects)

    if (remotePinned.length > 0) {
      isApplyingRemotePinnedState.value = true
      pinnedThreadIds.value = remotePinned
      lastPinnedStateSerialized = JSON.stringify(remotePinned)
    } else if (localPinned.length > 0) {
      await syncPinnedThreadIdsToServer(localPinned)
    }

    if (Object.keys(remoteCollapsed).length > 0) {
      isApplyingRemoteCollapsedState.value = true
      collapsedProjects.value = remoteCollapsed
      lastCollapsedSerialized = JSON.stringify(remoteCollapsed)
    } else if (Object.keys(localCollapsed).length > 0) {
      await syncCollapsedProjectsToServer(localCollapsed)
    }
  } catch {
    // Fall back to local state when remote chat-state is temporarily unavailable.
  } finally {
    isApplyingRemotePinnedState.value = false
    isApplyingRemoteCollapsedState.value = false
  }
})

watch(
  collapsedProjects,
  (value) => {
    if (typeof window === 'undefined') return
    const normalized = normalizeCollapsedProjectsRecord(value)
    const serialized = JSON.stringify(normalized)
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, serialized)

    if (serialized === lastCollapsedSerialized) return
    lastCollapsedSerialized = serialized
    if (isApplyingRemoteCollapsedState.value) return
    void syncCollapsedProjectsToServer(normalized)
  },
  { deep: true },
)

watch(
  pinnedThreadIds,
  (value) => {
    if (typeof window === 'undefined') return
    const normalized = normalizePinnedThreadIds(value)
    const serialized = JSON.stringify(normalized)
    window.localStorage.setItem(PINNED_THREADS_STORAGE_KEY, serialized)

    if (serialized === lastPinnedStateSerialized) return
    lastPinnedStateSerialized = serialized
    if (isApplyingRemotePinnedState.value) return
    void syncPinnedThreadIdsToServer(normalized)
  },
  { deep: true },
)

const normalizedSearchQuery = computed(() => props.searchQuery.trim().toLowerCase())

const isSearchActive = computed(() => normalizedSearchQuery.value.length > 0)

function threadMatchesSearch(thread: UiThread): boolean {
  if (!isSearchActive.value) return true
  const q = normalizedSearchQuery.value
  return (
    thread.title.toLowerCase().includes(q) ||
    thread.preview.toLowerCase().includes(q)
  )
}

const filteredGroups = computed<UiProjectGroup[]>(() => {
  if (!isSearchActive.value) return props.groups
  return props.groups
    .map((group) => ({
      ...group,
      threads: group.threads.filter(threadMatchesSearch),
    }))
    .filter((group) => group.threads.length > 0)
})

const threadById = computed(() => {
  const map = new Map<string, UiThread>()

  for (const group of props.groups) {
    for (const thread of group.threads) {
      map.set(thread.id, thread)
    }
  }

  return map
})

const pinnedThreads = computed(() =>
  pinnedThreadIds.value
    .map((threadId) => threadById.value.get(threadId) ?? null)
    .filter((thread): thread is UiThread => thread !== null)
    .filter(threadMatchesSearch),
)

const openThreadMenuThread = computed(() => {
  const threadId = openThreadMenu.value?.threadId
  return threadId ? threadById.value.get(threadId) ?? null : null
})

const threadMenuStyle = computed<Record<string, string>>(() => {
  const menu = openThreadMenu.value
  if (!menu) return { left: '0px', top: '0px' }
  return {
    left: `${menu.x}px`,
    top: `${menu.y}px`,
  }
})

const projectedDropProjectIndex = computed<number | null>(() => {
  const drag = activeProjectDrag.value
  if (!drag || drag.dropTargetIndexFull === null || props.groups.length === 0) return null

  const boundedDropIndex = Math.max(0, Math.min(drag.dropTargetIndexFull, props.groups.length))
  const projectedIndex = boundedDropIndex > drag.fromIndex ? boundedDropIndex - 1 : boundedDropIndex
  const boundedProjectedIndex = Math.max(0, Math.min(projectedIndex, props.groups.length - 1))
  return boundedProjectedIndex === drag.fromIndex ? null : boundedProjectedIndex
})

const layoutProjectOrder = computed<string[]>(() => {
  const sourceGroups = isSearchActive.value ? filteredGroups.value : props.groups
  const names = sourceGroups.map((group) => group.projectName)
  const drag = activeProjectDrag.value
  const projectedIndex = projectedDropProjectIndex.value

  if (!drag || projectedIndex === null) {
    return names
  }

  const next = [...names]
  const [movedProject] = next.splice(drag.fromIndex, 1)
  if (!movedProject) {
    return names
  }
  next.splice(projectedIndex, 0, movedProject)
  return next
})

const layoutTopByProject = computed<Record<string, number>>(() => {
  const topByProject: Record<string, number> = {}
  let currentTop = 0

  for (const projectName of layoutProjectOrder.value) {
    topByProject[projectName] = currentTop
    currentTop += getProjectOuterHeight(projectName)
  }

  return topByProject
})

const groupsContainerStyle = computed<Record<string, string>>(() => {
  let totalHeight = 0
  for (const projectName of layoutProjectOrder.value) {
    totalHeight += getProjectOuterHeight(projectName)
  }

  return {
    height: `${Math.max(0, totalHeight)}px`,
  }
})

function formatRelative(value: string): string {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return 'n/a'

  const diffMs = Math.abs(Date.now() - timestamp)
  if (diffMs < 60000) return 'now'

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  return `${days}d`
}

function isPinned(threadId: string): boolean {
  return pinnedThreadIds.value.includes(threadId)
}

function togglePin(threadId: string): void {
  if (isPinned(threadId)) {
    pinnedThreadIds.value = pinnedThreadIds.value.filter((id) => id !== threadId)
    return
  }

  pinnedThreadIds.value = [threadId, ...pinnedThreadIds.value]
}

function clampThreadMenuPosition(clientX: number, clientY: number): { x: number; y: number } {
  if (typeof window === 'undefined') {
    return { x: clientX, y: clientY }
  }

  return {
    x: Math.max(8, Math.min(clientX, window.innerWidth - THREAD_MENU_WIDTH_PX - 8)),
    y: Math.max(8, Math.min(clientY, window.innerHeight - THREAD_MENU_MAX_HEIGHT_PX - 8)),
  }
}

function isThreadMenuOpen(threadId: string): boolean {
  return openThreadMenu.value?.threadId === threadId
}

function openThreadMenuForThread(thread: UiThread, clientX: number, clientY: number): void {
  closeProjectMenu()
  const position = clampThreadMenuPosition(clientX, clientY)
  openThreadMenu.value = {
    threadId: thread.id,
    x: position.x,
    y: position.y,
    mode: 'actions',
  }
  threadRenameDraft.value = thread.title
}

function onThreadContextMenu(event: MouseEvent, thread: UiThread): void {
  openThreadMenuForThread(thread, event.clientX, event.clientY)
}

function closeThreadMenu(): void {
  openThreadMenu.value = null
  threadRenameDraft.value = ''
}

function onThreadMenuTogglePin(): void {
  const thread = openThreadMenuThread.value
  if (!thread) return
  togglePin(thread.id)
  closeThreadMenu()
}

function openThreadRenameMenu(): void {
  const thread = openThreadMenuThread.value
  const menu = openThreadMenu.value
  if (!thread || !menu) return
  threadRenameDraft.value = thread.title
  openThreadMenu.value = {
    ...menu,
    mode: 'rename',
  }
  nextTick(() => {
    threadRenameInputRef.value?.focus()
    threadRenameInputRef.value?.select()
  })
}

function submitThreadRename(): void {
  const thread = openThreadMenuThread.value
  const title = threadRenameDraft.value.trim()
  if (!thread || !title) return
  emit('rename-thread', {
    threadId: thread.id,
    title,
  })
  closeThreadMenu()
}

function onThreadMenuArchive(): void {
  const thread = openThreadMenuThread.value
  if (!thread) return
  pinnedThreadIds.value = pinnedThreadIds.value.filter((id) => id !== thread.id)
  archiveConfirmThreadId.value = ''
  emit('archive', thread.id)
  closeThreadMenu()
}

function onThreadMenuToggleUnread(): void {
  const thread = openThreadMenuThread.value
  if (!thread) return
  if (thread.unread) {
    emit('mark-thread-read', thread.id)
  } else {
    emit('mark-thread-unread', thread.id)
  }
  closeThreadMenu()
}

function onSelect(threadId: string): void {
  emit('select', threadId)
}

function onArchiveClick(threadId: string): void {
  if (archiveConfirmThreadId.value !== threadId) {
    archiveConfirmThreadId.value = threadId
    return
  }

  archiveConfirmThreadId.value = ''
  pinnedThreadIds.value = pinnedThreadIds.value.filter((id) => id !== threadId)
  emit('archive', threadId)
}

function getNewThreadButtonAriaLabel(projectName: string): string {
  return `start new thread ${getProjectDisplayName(projectName)}`
}

function onStartNewThread(projectName: string): void {
  emit('start-new-thread', projectName)
}

function onThreadRowLeave(threadId: string): void {
  if (archiveConfirmThreadId.value === threadId) {
    archiveConfirmThreadId.value = ''
  }
}

function getProjectDisplayName(projectName: string): string {
  return props.projectDisplayNameById[projectName] ?? projectName
}

function isProjectMenuOpen(projectName: string): boolean {
  return openProjectMenuId.value === projectName
}

function closeProjectMenu(): void {
  openProjectMenuId.value = ''
  projectMenuMode.value = 'actions'
  projectRenameDraft.value = ''
}

function toggleProjectMenu(projectName: string): void {
  if (openProjectMenuId.value === projectName) {
    closeProjectMenu()
    return
  }

  closeThreadMenu()
  openProjectMenuId.value = projectName
  projectMenuMode.value = 'actions'
  projectRenameDraft.value = getProjectDisplayName(projectName)
}

function openRenameProjectMenu(projectName: string): void {
  closeThreadMenu()
  openProjectMenuId.value = projectName
  projectMenuMode.value = 'rename'
  projectRenameDraft.value = getProjectDisplayName(projectName)
}

function onProjectNameInput(projectName: string): void {
  emit('rename-project', {
    projectName,
    displayName: projectRenameDraft.value,
  })
}

function onRemoveProject(projectName: string): void {
  emit('remove-project', projectName)
  closeProjectMenu()
}

function isExpanded(projectName: string): boolean {
  return expandedProjects.value[projectName] === true
}

function isCollapsed(projectName: string): boolean {
  return collapsedProjects.value[projectName] === true
}

function toggleProjectExpansion(projectName: string): void {
  expandedProjects.value = {
    ...expandedProjects.value,
    [projectName]: !isExpanded(projectName),
  }
}

function toggleProjectCollapse(projectName: string): void {
  if (suppressNextProjectToggleId.value === projectName) {
    suppressNextProjectToggleId.value = ''
    return
  }

  collapsedProjects.value = {
    ...collapsedProjects.value,
    [projectName]: !isCollapsed(projectName),
  }
}

function getProjectOuterHeight(projectName: string): number {
  const measuredHeight = measuredHeightByProject.value[projectName] ?? 0
  const drag = activeProjectDrag.value
  const dragHeight = drag?.projectName === projectName ? drag.groupHeight : null
  const baseHeight = dragHeight ?? measuredHeight
  const gap = isCollapsed(projectName) ? 0 : PROJECT_GROUP_EXPANDED_GAP_PX
  return Math.max(0, baseHeight + gap)
}

function setProjectMenuWrapRef(projectName: string, element: Element | ComponentPublicInstance | null): void {
  const htmlElement =
    element instanceof HTMLElement
      ? element
      : element && '$el' in element && element.$el instanceof HTMLElement
        ? element.$el
        : null

  if (htmlElement) {
    projectMenuWrapElementByName.set(projectName, htmlElement)
    return
  }

  projectMenuWrapElementByName.delete(projectName)
}

function updateProjectMenuPanelPosition(): void {
  const id = openProjectMenuId.value
  if (!id || typeof window === 'undefined') return

  const wrap = projectMenuWrapElementByName.get(id)
  if (!wrap) return

  const rect = wrap.getBoundingClientRect()
  projectMenuPanelPosition.value = {
    top: rect.bottom + PROJECT_MENU_ANCHOR_GAP_PX,
    left: rect.right,
  }
}

function isEventInsideOpenProjectMenu(event: Event): boolean {
  const projectName = openProjectMenuId.value
  if (!projectName) return false

  const openMenuWrapElement = projectMenuWrapElementByName.get(projectName)
  const panel = projectMenuPanelRef.value

  const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (openMenuWrapElement && eventPath.includes(openMenuWrapElement)) return true
  if (panel && eventPath.includes(panel)) return true

  const target = event.target
  if (openMenuWrapElement && target instanceof Node && openMenuWrapElement.contains(target)) return true
  if (panel && target instanceof Node && panel.contains(target)) return true
  return false
}

function isEventInsideOpenThreadMenu(event: Event): boolean {
  const openMenuElement = threadMenuPanelRef.value
  if (!openMenuElement) return false

  const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (eventPath.includes(openMenuElement)) return true

  const target = event.target
  return target instanceof Node ? openMenuElement.contains(target) : false
}

function onThreadMenuPointerDown(event: PointerEvent): void {
  if (!openThreadMenu.value) return
  if (isEventInsideOpenThreadMenu(event)) return
  closeThreadMenu()
}

function onThreadMenuFocusIn(event: FocusEvent): void {
  if (!openThreadMenu.value) return
  if (isEventInsideOpenThreadMenu(event)) return
  closeThreadMenu()
}

function onThreadMenuKeyDown(event: KeyboardEvent): void {
  if (!openThreadMenu.value) return
  if (event.key !== 'Escape') return
  event.preventDefault()
  closeThreadMenu()
}

function onWindowBlurForThreadMenu(): void {
  if (!openThreadMenu.value) return
  closeThreadMenu()
}

function bindThreadMenuDismissListeners(): void {
  window.addEventListener('pointerdown', onThreadMenuPointerDown, { capture: true })
  window.addEventListener('focusin', onThreadMenuFocusIn, { capture: true })
  window.addEventListener('keydown', onThreadMenuKeyDown)
  window.addEventListener('blur', onWindowBlurForThreadMenu)
}

function unbindThreadMenuDismissListeners(): void {
  window.removeEventListener('pointerdown', onThreadMenuPointerDown, { capture: true })
  window.removeEventListener('focusin', onThreadMenuFocusIn, { capture: true })
  window.removeEventListener('keydown', onThreadMenuKeyDown)
  window.removeEventListener('blur', onWindowBlurForThreadMenu)
}

function onProjectMenuPointerDown(event: PointerEvent): void {
  if (!openProjectMenuId.value) return
  if (isEventInsideOpenProjectMenu(event)) return
  closeProjectMenu()
}

function onProjectMenuFocusIn(event: FocusEvent): void {
  if (!openProjectMenuId.value) return
  if (isEventInsideOpenProjectMenu(event)) return
  closeProjectMenu()
}

function onWindowBlurForProjectMenu(): void {
  if (!openProjectMenuId.value) return
  closeProjectMenu()
}

function bindProjectMenuDismissListeners(): void {
  window.addEventListener('pointerdown', onProjectMenuPointerDown, { capture: true })
  window.addEventListener('focusin', onProjectMenuFocusIn, { capture: true })
  window.addEventListener('blur', onWindowBlurForProjectMenu)
  window.addEventListener('resize', updateProjectMenuPanelPosition)
  projectMenuScrollParent = threadTreeScrollRef.value
  projectMenuScrollParent?.addEventListener('scroll', updateProjectMenuPanelPosition, { passive: true })
}

function unbindProjectMenuDismissListeners(): void {
  window.removeEventListener('pointerdown', onProjectMenuPointerDown, { capture: true })
  window.removeEventListener('focusin', onProjectMenuFocusIn, { capture: true })
  window.removeEventListener('blur', onWindowBlurForProjectMenu)
  window.removeEventListener('resize', updateProjectMenuPanelPosition)
  projectMenuScrollParent?.removeEventListener('scroll', updateProjectMenuPanelPosition)
  projectMenuScrollParent = null
}

function updateMeasuredProjectHeight(projectName: string, element: HTMLElement): void {
  const nextHeight = element.getBoundingClientRect().height
  if (!Number.isFinite(nextHeight) || nextHeight <= 0) return

  const previousHeight = measuredHeightByProject.value[projectName]
  if (previousHeight !== undefined && Math.abs(previousHeight - nextHeight) < 0.5) {
    return
  }

  measuredHeightByProject.value = {
    ...measuredHeightByProject.value,
    [projectName]: nextHeight,
  }
}

function setProjectGroupRef(projectName: string, element: Element | ComponentPublicInstance | null): void {
  const previousElement = projectGroupElementByName.get(projectName)
  if (previousElement && previousElement !== element && projectGroupResizeObserver) {
    projectGroupResizeObserver.unobserve(previousElement)
  }

  const htmlElement =
    element instanceof HTMLElement
      ? element
      : element && '$el' in element && element.$el instanceof HTMLElement
        ? element.$el
        : null

  if (htmlElement) {
    projectGroupElementByName.set(projectName, htmlElement)
    projectNameByElement.set(htmlElement, projectName)
    updateMeasuredProjectHeight(projectName, htmlElement)
    projectGroupResizeObserver?.observe(htmlElement)
    return
  }

  if (previousElement) {
    projectGroupResizeObserver?.unobserve(previousElement)
  }

  projectGroupElementByName.delete(projectName)
}

function onProjectHandleMouseDown(event: MouseEvent, projectName: string): void {
  if (event.button !== 0) return
  if (pendingProjectDrag.value || activeProjectDrag.value) return

  const fromIndex = props.groups.findIndex((group) => group.projectName === projectName)
  const projectGroupElement = projectGroupElementByName.get(projectName)
  if (fromIndex < 0 || !projectGroupElement) return

  const groupRect = projectGroupElement.getBoundingClientRect()
  const groupGap = isCollapsed(projectName) ? 0 : PROJECT_GROUP_EXPANDED_GAP_PX
  pendingProjectDrag.value = {
    projectName,
    fromIndex,
    startClientX: event.clientX,
    startClientY: event.clientY,
    pointerOffsetY: event.clientY - groupRect.top,
    groupLeft: groupRect.left,
    groupWidth: groupRect.width,
    groupHeight: groupRect.height,
    groupOuterHeight: groupRect.height + groupGap,
  }

  event.preventDefault()
  bindProjectDragListeners()
}

function bindProjectDragListeners(): void {
  window.addEventListener('mousemove', onProjectDragMouseMove)
  window.addEventListener('mouseup', onProjectDragMouseUp)
  window.addEventListener('keydown', onProjectDragKeyDown)
}

function unbindProjectDragListeners(): void {
  window.removeEventListener('mousemove', onProjectDragMouseMove)
  window.removeEventListener('mouseup', onProjectDragMouseUp)
  window.removeEventListener('keydown', onProjectDragKeyDown)
}

function onProjectDragMouseMove(event: MouseEvent): void {
  pendingDragPointerSample = {
    clientX: event.clientX,
    clientY: event.clientY,
  }
  scheduleProjectDragPointerFrame()
}

function onProjectDragMouseUp(event: MouseEvent): void {
  processProjectDragPointerSample({
    clientX: event.clientX,
    clientY: event.clientY,
  })

  const drag = activeProjectDrag.value
  if (drag && projectedDropProjectIndex.value !== null) {
    const currentProjectIndex = props.groups.findIndex((group) => group.projectName === drag.projectName)
    if (currentProjectIndex >= 0) {
      const toIndex = projectedDropProjectIndex.value
      if (toIndex !== currentProjectIndex) {
        emit('reorder-project', {
          projectName: drag.projectName,
          toIndex,
        })
      }
    }
  }

  resetProjectDragState()
}

function onProjectDragKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (!pendingProjectDrag.value && !activeProjectDrag.value) return

  event.preventDefault()
  resetProjectDragState()
}

function resetProjectDragState(): void {
  if (dragPointerRafId !== null) {
    window.cancelAnimationFrame(dragPointerRafId)
    dragPointerRafId = null
  }
  pendingDragPointerSample = null
  pendingProjectDrag.value = null
  activeProjectDrag.value = null
  suppressNextProjectToggleId.value = ''
  unbindProjectDragListeners()
}

function scheduleProjectDragPointerFrame(): void {
  if (dragPointerRafId !== null) return

  dragPointerRafId = window.requestAnimationFrame(() => {
    dragPointerRafId = null
    if (!pendingDragPointerSample) return

    const sample = pendingDragPointerSample
    pendingDragPointerSample = null
    processProjectDragPointerSample(sample)
  })
}

function processProjectDragPointerSample(sample: DragPointerSample): void {
  const pending = pendingProjectDrag.value
  if (!activeProjectDrag.value && pending) {
    const deltaX = sample.clientX - pending.startClientX
    const deltaY = sample.clientY - pending.startClientY
    const distance = Math.hypot(deltaX, deltaY)
    if (distance < DRAG_START_THRESHOLD_PX) {
      return
    }

    closeProjectMenu()
    closeThreadMenu()
    suppressNextProjectToggleId.value = pending.projectName
    activeProjectDrag.value = {
      projectName: pending.projectName,
      fromIndex: pending.fromIndex,
      pointerOffsetY: pending.pointerOffsetY,
      groupLeft: pending.groupLeft,
      groupWidth: pending.groupWidth,
      groupHeight: pending.groupHeight,
      groupOuterHeight: pending.groupOuterHeight,
      ghostTop: sample.clientY - pending.pointerOffsetY,
      dropTargetIndexFull: null,
    }
  }

  if (!activeProjectDrag.value) return
  updateProjectDropTarget(sample)
}

function updateProjectDropTarget(sample: DragPointerSample): void {
  const drag = activeProjectDrag.value
  if (!drag) return

  drag.ghostTop = sample.clientY - drag.pointerOffsetY
  if (!isPointerInProjectDropZone(sample)) {
    drag.dropTargetIndexFull = null
    return
  }

  const cursorY = sample.clientY
  const groupsContainer = groupsContainerRef.value
  if (!groupsContainer) {
    drag.dropTargetIndexFull = null
    return
  }

  const containerRect = groupsContainer.getBoundingClientRect()
  const projectIndexByName = new Map(props.groups.map((group, index) => [group.projectName, index]))
  const nonDraggedProjectNames = props.groups
    .map((group) => group.projectName)
    .filter((projectName) => projectName !== drag.projectName)

  let accumulatedTop = 0
  let nextDropTarget = props.groups.length

  for (const projectName of nonDraggedProjectNames) {
    const originalIndex = projectIndexByName.get(projectName)
    if (originalIndex === undefined) continue

    const groupOuterHeight = getProjectOuterHeight(projectName)
    const groupMiddleY = containerRect.top + accumulatedTop + groupOuterHeight / 2
    if (cursorY < groupMiddleY) {
      nextDropTarget = originalIndex
      break
    }

    accumulatedTop += groupOuterHeight
  }

  drag.dropTargetIndexFull = nextDropTarget
}

function isPointerInProjectDropZone(sample: DragPointerSample): boolean {
  const groupsContainer = groupsContainerRef.value
  if (!groupsContainer) return false

  const bounds = groupsContainer.getBoundingClientRect()
  const xInBounds = sample.clientX >= bounds.left && sample.clientX <= bounds.right
  const yInBounds = sample.clientY >= bounds.top - 32 && sample.clientY <= bounds.bottom + 32
  return xInBounds && yInBounds
}

function isDraggingProject(projectName: string): boolean {
  return activeProjectDrag.value?.projectName === projectName
}

function projectGroupStyle(projectName: string): Record<string, string> | undefined {
  const drag = activeProjectDrag.value
  const targetTop = layoutTopByProject.value[projectName] ?? 0

  if (!drag || drag.projectName !== projectName) {
    return {
      position: 'absolute',
      top: '0',
      left: '0',
      right: '0',
      transform: `translate3d(0, ${targetTop}px, 0)`,
      willChange: 'transform',
      transition: 'transform 180ms ease',
    }
  }

  return {
    position: 'fixed',
    top: '0',
    left: `${drag.groupLeft}px`,
    width: `${drag.groupWidth}px`,
    height: `${drag.groupHeight}px`,
    zIndex: '50',
    pointerEvents: 'none',
    transform: `translate3d(0, ${drag.ghostTop}px, 0)`,
    willChange: 'transform',
    transition: 'transform 0ms linear',
  }
}

function projectThreads(group: UiProjectGroup): UiThread[] {
  return group.threads.filter((thread) => !isPinned(thread.id))
}

function visibleThreads(group: UiProjectGroup): UiThread[] {
  if (isSearchActive.value) return projectThreads(group)
  if (isCollapsed(group.projectName)) return []

  const rows = projectThreads(group)
  return isExpanded(group.projectName) ? rows : rows.slice(0, 10)
}

function hasHiddenThreads(group: UiProjectGroup): boolean {
  if (isSearchActive.value) return false
  return !isCollapsed(group.projectName) && projectThreads(group).length > 10
}

function hasThreads(group: UiProjectGroup): boolean {
  return projectThreads(group).length > 0
}

function getThreadState(thread: UiThread): 'working' | 'unread' | 'idle' {
  if (thread.inProgress) return 'working'
  if (thread.unread) return 'unread'
  return 'idle'
}

watch(
  () => props.groups.map((group) => group.projectName),
  (projectNames) => {
    const dragProjectName = activeProjectDrag.value?.projectName ?? pendingProjectDrag.value?.projectName ?? ''
    if (dragProjectName && !props.groups.some((group) => group.projectName === dragProjectName)) {
      resetProjectDragState()
    }

    const projectNameSet = new Set(projectNames)
    const nextMeasuredHeights = Object.fromEntries(
      Object.entries(measuredHeightByProject.value).filter(([projectName]) => projectNameSet.has(projectName)),
    ) as Record<string, number>

    if (Object.keys(nextMeasuredHeights).length !== Object.keys(measuredHeightByProject.value).length) {
      measuredHeightByProject.value = nextMeasuredHeights
    }
  },
)

watch(
  threadById,
  (map) => {
    // While `groups` is still empty or not yet hydrated, `threadById` is empty. Pruning pinned
    // ids against an empty map would clear all pins and PATCH [] to the server before onMounted
    // can merge remote state — wiping persisted chat-state on every reload.
    if (map.size === 0) return

    const nextPinned = pinnedThreadIds.value.filter((threadId) => map.has(threadId))
    if (nextPinned.length !== pinnedThreadIds.value.length) {
      pinnedThreadIds.value = nextPinned
    }
  },
  { immediate: true },
)

watch(openProjectMenuId, (projectName, previous) => {
  if (projectName) {
    if (!previous) {
      bindProjectMenuDismissListeners()
    }
    nextTick(() => {
      updateProjectMenuPanelPosition()
      requestAnimationFrame(() => {
        updateProjectMenuPanelPosition()
      })
    })
    return
  }

  unbindProjectMenuDismissListeners()
})

watch(projectMenuMode, () => {
  if (!openProjectMenuId.value) return
  nextTick(() => {
    updateProjectMenuPanelPosition()
    requestAnimationFrame(() => {
      updateProjectMenuPanelPosition()
    })
  })
})

watch(
  () => openThreadMenu.value?.threadId ?? '',
  (threadId) => {
    if (threadId) {
      bindThreadMenuDismissListeners()
      return
    }

    unbindThreadMenuDismissListeners()
  },
)

onBeforeUnmount(() => {
  for (const element of projectGroupElementByName.values()) {
    projectGroupResizeObserver?.unobserve(element)
  }
  projectGroupElementByName.clear()
  projectMenuWrapElementByName.clear()
  unbindProjectMenuDismissListeners()
  unbindThreadMenuDismissListeners()
  resetProjectDragState()
})
</script>

<style scoped>
@reference "tailwindcss";

.thread-tree-root {
  @apply flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden;
}

.thread-tree-scroll {
  @apply flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden;
}

.pinned-section {
  @apply mb-1 shrink-0;
}

.thread-tree-header-row {
  @apply shrink-0 cursor-default;
}

.thread-tree-header {
  @apply text-sm font-normal text-zinc-500 select-none;
}

.thread-start-button {
  @apply h-5 w-5 rounded text-zinc-500 flex items-center justify-center transition hover:bg-zinc-200 hover:text-zinc-700;
}

.thread-tree-loading {
  @apply px-3 py-2 text-sm text-zinc-500;
}

.thread-tree-no-results {
  @apply px-3 py-2 text-sm text-zinc-400;
}

.thread-tree-groups {
  @apply pr-0.5 relative;
}

.project-group {
  @apply m-0 transition-shadow;
}

.project-group[data-dragging='true'] {
  @apply shadow-lg;
}

.project-header-row {
  @apply hover:bg-zinc-200 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400;
}

.project-main-button {
  @apply min-w-0 w-full text-left rounded px-0 py-0 flex items-center min-h-5 cursor-grab;
}

.project-main-button[data-dragging-handle='true'] {
  @apply cursor-grabbing;
}

.project-icon-stack {
  @apply relative w-4 h-4 flex items-center justify-center text-zinc-500;
}

.project-icon-folder {
  @apply absolute inset-0 flex items-center justify-center opacity-100;
}

.project-icon-chevron {
  @apply absolute inset-0 items-center justify-center opacity-0 hidden;
}

.project-title {
  @apply text-sm font-normal text-zinc-700 truncate select-none;
}

.project-menu-wrap {
  @apply relative;
}

.project-menu-teleport-root {
  @apply pointer-events-none;
}

.project-menu-teleport-root .project-menu-panel {
  @apply pointer-events-auto;
}

.project-hover-controls {
  @apply flex items-center gap-1;
}

.project-menu-trigger {
  @apply h-4 w-4 rounded p-0 text-zinc-600 flex items-center justify-center;
}

.project-menu-panel {
  @apply fixed z-[100] min-w-36 -translate-x-full rounded-md border border-zinc-200 bg-white p-1 shadow-md flex flex-col gap-0.5;
}

.project-menu-item {
  @apply rounded px-2 py-1 text-left text-sm text-zinc-700 hover:bg-zinc-100;
}

.project-menu-item-danger {
  @apply text-rose-700 hover:bg-rose-50;
}

.project-menu-label {
  @apply px-2 pt-1 text-xs text-zinc-500;
}

.project-menu-input {
  @apply px-2 py-1 text-sm text-zinc-800 bg-transparent border-none outline-none;
}

.project-empty-row {
  @apply cursor-default;
}

.project-empty-spacer {
  @apply block w-4 h-4;
}

.project-empty {
  @apply text-sm text-zinc-400;
}

.thread-list {
  @apply list-none m-0 p-0 flex flex-col gap-0.5;
}

.project-group > .thread-list {
  @apply mt-0.5;
}

.thread-row-item {
  @apply m-0;
}

.thread-row {
  @apply hover:bg-zinc-200;
}

.thread-context-menu {
  @apply fixed z-50 flex w-[13.75rem] flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-xl;
}

.thread-context-menu-item {
  @apply rounded-md px-3 py-1.5 text-left text-sm font-normal text-zinc-800 hover:bg-zinc-100;
}

.thread-context-rename-form {
  @apply flex flex-col gap-1;
}

.thread-context-menu-label {
  @apply px-2 pt-1 text-xs text-zinc-500;
}

.thread-context-menu-input {
  @apply rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-500;
}

.thread-context-menu-actions {
  @apply mt-1 flex gap-1;
}

.thread-left-stack {
  @apply relative w-4 h-4 flex items-center justify-center;
}

.thread-pin-button {
  @apply absolute inset-0 w-4 h-4 rounded text-zinc-500 opacity-0 pointer-events-none transition flex items-center justify-center;
}

.thread-main-button {
  @apply min-w-0 w-full text-left rounded px-0 py-0 flex items-center min-h-5;
}

.thread-row-title {
  @apply block text-sm leading-5 font-normal text-zinc-800 truncate whitespace-nowrap;
}

.thread-status-indicator {
  @apply w-2.5 h-2.5 rounded-full;
}

.thread-row-time {
  @apply block text-sm font-normal text-zinc-500;
}

.thread-archive-button {
  @apply h-4 w-4 rounded p-0 text-xs text-zinc-600 flex items-center justify-center;
}

.thread-archive-button[data-confirm='true'] {
  @apply h-5 w-auto px-1.5;
}

.thread-icon {
  @apply w-4 h-4;
}

.thread-show-more-row {
  @apply mt-1;
}

.thread-show-more-spacer {
  @apply block w-4 h-4;
}

.thread-show-more-button {
  @apply block mx-auto rounded-lg px-2 py-0.5 text-sm font-normal text-zinc-600 transition hover:text-zinc-800 hover:bg-zinc-200;
}

.project-header-row:hover .project-icon-folder {
  @apply opacity-0;
}

.project-header-row:hover .project-icon-chevron {
  @apply flex opacity-100;
}

.thread-row[data-active='true'] {
  @apply bg-zinc-200;
}

.thread-row:hover .thread-pin-button,
.thread-row:focus-within .thread-pin-button {
  @apply opacity-100 pointer-events-auto;
}

.thread-status-indicator[data-state='unread'] {
  width: 6.6667px;
  height: 6.6667px;
  @apply bg-blue-600;
}

.thread-status-indicator[data-state='working'] {
  @apply border-2 border-zinc-500 border-t-transparent bg-transparent animate-spin;
}

.thread-row:hover .thread-status-indicator[data-state='unread'],
.thread-row:hover .thread-status-indicator[data-state='working'],
.thread-row:focus-within .thread-status-indicator[data-state='unread'],
.thread-row:focus-within .thread-status-indicator[data-state='working'] {
  @apply opacity-0;
}
</style>
