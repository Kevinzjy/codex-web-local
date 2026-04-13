<template>
  <div ref="rootRef" class="composer-dropdown">
    <button
      class="composer-dropdown-trigger"
      type="button"
      :disabled="disabled"
      @click="onToggle"
    >
      <span class="composer-dropdown-value">{{ selectedLabel }}</span>
      <IconTablerChevronDown class="composer-dropdown-chevron" />
    </button>

    <div
      v-if="isOpen"
      class="composer-dropdown-menu-wrap"
      :class="{
        'composer-dropdown-menu-wrap-up': openDirection === 'up',
        'composer-dropdown-menu-wrap-down': openDirection === 'down',
      }"
    >
      <div class="composer-dropdown-menu">
        <input
          v-if="searchable"
          ref="searchInputRef"
          v-model="searchQuery"
          class="composer-dropdown-search"
          type="text"
          :placeholder="searchPlaceholder || 'Search'"
        />

        <ul class="composer-dropdown-options" role="listbox">
          <li v-for="option in filteredOptions" :key="option.value">
            <button
              class="composer-dropdown-option"
              :class="{ 'is-selected': option.value === modelValue }"
              type="button"
              @click="onSelect(option.value)"
            >
              {{ option.label }}
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
              ref="addOptionInputRef"
              v-model="newOptionValue"
              class="composer-dropdown-add-input"
              type="text"
              :placeholder="addOptionPlaceholder || 'Value'"
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'

type DropdownOption = {
  value: string
  label: string
}

const props = defineProps<{
  modelValue: string
  options: DropdownOption[]
  placeholder?: string
  disabled?: boolean
  openDirection?: 'up' | 'down'
  searchable?: boolean
  searchPlaceholder?: string
  addOptionLabel?: string
  addOptionPlaceholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  addOption: [value: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const addOptionInputRef = ref<HTMLInputElement | null>(null)
const isOpen = ref(false)
const searchQuery = ref('')
const isAddingOption = ref(false)
const newOptionValue = ref('')

const selectedLabel = computed(() => {
  const selected = props.options.find((option) => option.value === props.modelValue)
  if (selected) return selected.label
  return props.placeholder?.trim() || ''
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
  @apply inline-flex h-7 items-center gap-1 border-0 bg-transparent p-0 text-sm leading-none text-zinc-500 outline-none transition;
}

.composer-dropdown-trigger:disabled {
  @apply cursor-not-allowed text-zinc-500;
}

.composer-dropdown-value {
  @apply whitespace-nowrap text-left;
}

.composer-dropdown-chevron {
  @apply mt-px h-3.5 w-3.5 shrink-0 text-zinc-500;
}

.composer-dropdown-menu-wrap {
  @apply absolute left-0 z-30;
}

.composer-dropdown-menu-wrap-down {
  @apply top-[calc(100%+8px)];
}

.composer-dropdown-menu-wrap-up {
  @apply bottom-[calc(100%+8px)];
}

.composer-dropdown-menu {
  @apply min-w-40 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg;
}

.composer-dropdown-search {
  @apply mb-1 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400;
}

.composer-dropdown-options {
  @apply m-0 max-h-64 list-none overflow-y-auto p-0;
}

.composer-dropdown-option {
  @apply flex w-full items-center rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100;
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
