<template>
  <div ref="rootRef" class="composer-dropdown">
    <button
      class="composer-dropdown-trigger"
      type="button"
      :class="{ 'composer-dropdown-trigger--permission-full': selectedDecoration === 'permission-full' }"
      :disabled="disabled"
      @click="onToggle"
    >
      <PermissionModeIcon
        v-if="selectedDecoration === 'permission-default' || selectedDecoration === 'permission-full'"
        :variant="selectedDecoration === 'permission-full' ? 'full' : 'default'"
        class="composer-dropdown-perm-icon"
      />
      <span class="composer-dropdown-value">{{ selectedLabel }}</span>
      <IconTablerChevronDown class="composer-dropdown-chevron" />
    </button>

    <div
      v-if="isOpen"
      class="composer-dropdown-menu-wrap"
      :class="{
        'composer-dropdown-menu-wrap-up': openDirection === 'up',
        'composer-dropdown-menu-wrap-down': openDirection === 'down',
        'composer-dropdown-menu-wrap-align-end': menuAlign === 'end',
      }"
    >
      <div class="composer-dropdown-menu">
        <input
          v-if="searchable"
          :id="`${fieldId}-search`"
          ref="searchInputRef"
          v-model="searchQuery"
          class="composer-dropdown-search"
          type="search"
          :name="`${fieldId}-search`"
          :placeholder="searchPlaceholder || 'Search'"
          autocomplete="off"
        />

        <ul class="composer-dropdown-options" role="listbox">
          <li v-for="option in filteredOptions" :key="option.value">
            <button
              class="composer-dropdown-option"
              :class="{
                'is-selected': option.value === modelValue,
                'composer-dropdown-option--permission-full': option.decoration === 'permission-full',
                'composer-dropdown-option--permission':
                  option.decoration === 'permission-default' || option.decoration === 'permission-full',
              }"
              type="button"
              @click="onSelect(option.value)"
            >
              <PermissionModeIcon
                v-if="option.decoration === 'permission-default' || option.decoration === 'permission-full'"
                :variant="option.decoration === 'permission-full' ? 'full' : 'default'"
                class="composer-dropdown-option-icon"
              />
              <span class="composer-dropdown-option-label">{{ option.label }}</span>
            </button>
          </li>
        </ul>

        <p v-if="filteredOptions.length === 0" class="composer-dropdown-empty">No matches</p>

        <div v-if="addOptionLabel" class="composer-dropdown-add">
          <button v-if="!isAddingOption" class="composer-dropdown-add-button" type="button" @click="openAddOptionForm">
            {{ addOptionLabel }}
          </button>
          <form v-else class="composer-dropdown-add-form" @submit.prevent="onAddOptionSubmit">
            <input
              :id="`${fieldId}-add`"
              ref="addOptionInputRef"
              v-model="newOptionValue"
              class="composer-dropdown-add-input"
              type="text"
              :name="`${fieldId}-add`"
              :placeholder="addOptionPlaceholder || 'Value'"
              autocomplete="off"
              @keydown.escape.prevent="closeAddOptionForm"
            />
            <button class="composer-dropdown-add-submit" type="submit">Add</button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, withDefaults } from 'vue'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'
import PermissionModeIcon from './PermissionModeIcon.vue'

type DropdownOption = {
  value: string
  label: string
  /** If set, shown on the closed trigger instead of `label` (e.g. short status text). */
  triggerLabel?: string
  /** Shield + prompt / warning icon for permission mode rows */
  decoration?: 'permission-default' | 'permission-full'
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: DropdownOption[]
    placeholder?: string
    disabled?: boolean
    openDirection?: 'up' | 'down'
    /** When the trigger sits on the right edge, use "end" so the panel aligns to the trigger and stays in the viewport. */
    menuAlign?: 'start' | 'end'
    searchable?: boolean
    searchPlaceholder?: string
    addOptionLabel?: string
    addOptionPlaceholder?: string
    /** When set, "Add new project" opens the parent overlay instead of inline text entry. */
    directoryPicker?: boolean
  }>(),
  {
    menuAlign: 'start',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  addOption: [value: string]
  'request-directory-picker': []
}>()

const fieldId = useId()
const rootRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const addOptionInputRef = ref<HTMLInputElement | null>(null)
const isOpen = ref(false)
const searchQuery = ref('')
const isAddingOption = ref(false)
const newOptionValue = ref('')

const selectedLabel = computed(() => {
  const selected = props.options.find((option) => option.value === props.modelValue)
  if (selected) return selected.triggerLabel ?? selected.label
  return props.placeholder?.trim() || ''
})

const selectedDecoration = computed(() => {
  const selected = props.options.find((option) => option.value === props.modelValue)
  return selected?.decoration
})

const openDirection = computed(() => props.openDirection ?? 'down')

const filteredOptions = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return props.options
  return props.options.filter((option) =>
    option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query),
  )
})

function onToggle(): void {
  if (props.disabled) return
  isOpen.value = !isOpen.value
  if (isOpen.value && props.searchable) {
    nextTick(() => searchInputRef.value?.focus())
  }
}

function closeDropdown(): void {
  isOpen.value = false
  isAddingOption.value = false
  newOptionValue.value = ''
}

function onSelect(value: string): void {
  emit('update:modelValue', value)
  closeDropdown()
}

function openAddOptionForm(): void {
  if (props.directoryPicker) {
    emit('request-directory-picker')
    closeDropdown()
    return
  }
  isAddingOption.value = true
  nextTick(() => addOptionInputRef.value?.focus())
}

function closeAddOptionForm(): void {
  isAddingOption.value = false
  newOptionValue.value = ''
}

function onAddOptionSubmit(): void {
  const value = newOptionValue.value.trim()
  if (!value) return
  emit('addOption', value)
  closeDropdown()
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen.value) return
  const root = rootRef.value
  if (!root) return

  const target = event.target
  if (!(target instanceof Node)) return
  if (root.contains(target)) return
  closeDropdown()
}

onMounted(() => {
  window.addEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onDocumentPointerDown)
})
</script>

<style scoped>
@reference "tailwindcss";

.composer-dropdown {
  @apply relative inline-flex min-w-0;
}

.composer-dropdown-trigger {
  @apply inline-flex h-7 max-w-full min-w-0 items-center gap-1 border-0 bg-transparent p-0 text-sm leading-none text-zinc-500 outline-none transition;
}

.composer-dropdown-trigger--permission-full {
  @apply text-orange-400;
}

.composer-dropdown-trigger:disabled {
  @apply cursor-not-allowed text-zinc-500;
}

.composer-dropdown-perm-icon {
  @apply shrink-0;
}

.composer-dropdown-value {
  @apply min-w-0 truncate text-left;
}

.composer-dropdown-chevron {
  @apply mt-px h-3.5 w-3.5 shrink-0 text-zinc-500;
}

.composer-dropdown-trigger--permission-full .composer-dropdown-chevron {
  @apply text-orange-400;
}

.composer-dropdown-option-icon {
  @apply shrink-0;
}

.composer-dropdown-option-label {
  @apply min-w-0 flex-1 text-left;
}

.composer-dropdown-option--permission-full {
  @apply text-orange-400;
}

.composer-dropdown-option--permission-full:hover {
  @apply bg-orange-950/30;
}

.composer-dropdown-menu-wrap {
  @apply absolute left-0 z-30;
}

.composer-dropdown-menu-wrap-align-end {
  @apply right-0 left-auto;
}

.composer-dropdown-menu-wrap-down {
  @apply top-[calc(100%+8px)];
}

.composer-dropdown-menu-wrap-up {
  @apply bottom-[calc(100%+8px)];
}

.composer-dropdown-menu {
  @apply min-w-40 max-w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-zinc-200 bg-white p-1 shadow-lg;
}

.composer-dropdown-search {
  @apply mb-1 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400;
}

.composer-dropdown-options {
  @apply m-0 max-h-64 list-none overflow-y-auto p-0;
}

.composer-dropdown-option {
  @apply flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100;
}

.composer-dropdown-option--permission {
  @apply whitespace-nowrap;
}

.composer-dropdown-option.is-selected {
  @apply bg-zinc-100;
}

.composer-dropdown-empty {
  @apply m-0 px-2 py-1.5 text-left text-sm text-zinc-500;
}

.composer-dropdown-add {
  @apply mt-1 border-t border-zinc-100 pt-1;
}

.composer-dropdown-add-button {
  @apply flex w-full items-center rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100;
}

.composer-dropdown-add-form {
  @apply flex min-w-72 items-center gap-1;
}

.composer-dropdown-add-input {
  @apply min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400;
}

.composer-dropdown-add-submit {
  @apply rounded-lg border border-zinc-200 bg-zinc-900 px-2 py-1.5 text-sm text-white transition hover:bg-black;
}
</style>
