<script setup lang="ts">
import { ChevronRight, Folder } from 'lucide-vue-next';
import type { Entry } from './bridge';
defineProps<{ uri: string; label: string; current: string; tree: Record<string, Entry[]>; expanded: Set<string>; busy: boolean; depth?: number }>();
defineEmits<{ navigate: [uri: string]; toggle: [uri: string] }>();
</script>
<template>
  <li>
    <div class="flex min-w-0 items-center gap-1 rounded" :class="current === uri ? 'bg-base-300' : ''" :style="{ paddingLeft: `${(depth || 0) * 12}px` }">
      <button class="btn btn-xs btn-square btn-ghost shrink-0" :aria-label="`${expanded.has(uri) ? '折叠' : '展开'} ${label}`" :aria-expanded="expanded.has(uri)" :disabled="busy" @click="$emit('toggle', uri)"><ChevronRight :size="14" :class="expanded.has(uri) ? 'rotate-90' : ''" /></button>
      <button class="flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left text-sm" :title="label" :disabled="busy" @click="$emit('navigate', uri)"><Folder :size="15" class="shrink-0 text-warning" /><span class="truncate">{{ label }}</span></button>
    </div>
    <ul v-if="expanded.has(uri)">
      <DirectoryTree v-for="entry in tree[uri] || []" :key="entry.uri" :uri="entry.uri" :label="entry.name" :current="current" :tree="tree" :expanded="expanded" :busy="busy" :depth="(depth || 0) + 1" @navigate="$emit('navigate', $event)" @toggle="$emit('toggle', $event)" />
    </ul>
  </li>
</template>
