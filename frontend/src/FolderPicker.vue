<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-vue-next';
import { sortEntries, type Entry } from './bridge';
import FileName from './FileName.vue';

const props = defineProps<{
  root: string;
  modelValue: string;
  load: (uri: string, cursor?: string) => Promise<{ entries: Entry[]; nextCursor?: string }>;
}>();
const emit = defineEmits<{ 'update:modelValue': [uri: string] }>();
const expanded = ref(new Set<string>());
const branches = ref<Record<string, Entry[]>>({});
const cursors = ref<Record<string, string | undefined>>({});
const loading = ref(new Set<string>());
const errors = ref<Record<string, string>>({});
let disposed = false;
const rows = computed(() => {
  const result: { entry: Entry; depth: number; more?: boolean }[] = [];
  function visit(entry: Entry, depth: number) {
    result.push({ entry, depth });
    if (!expanded.value.has(entry.uri)) return;
    for (const child of sortEntries(branches.value[entry.uri] || [])) visit(child, depth + 1);
    if (cursors.value[entry.uri]) result.push({ entry, depth: depth + 1, more: true });
  }
  visit({ name: '/', uri: props.root, kind: 'directory' }, 0);
  return result;
});
async function fetchBranch(uri: string, more = false) {
  if (loading.value.has(uri)) return;
  loading.value.add(uri); delete errors.value[uri];
  try {
    const result = await props.load(uri, more ? cursors.value[uri] : undefined);
    if (disposed) return;
    branches.value[uri] = more ? [...(branches.value[uri] || []), ...result.entries] : result.entries;
    cursors.value[uri] = result.nextCursor;
    expanded.value.add(uri);
  } catch {
    if (!disposed) errors.value[uri] = '目录加载失败';
  } finally { if (!disposed) loading.value.delete(uri); }
}
async function toggle(uri: string) {
  if (loading.value.has(uri)) return;
  if (expanded.value.has(uri)) { expanded.value.delete(uri); return; }
  if (branches.value[uri]) expanded.value.add(uri);
  else await fetchBranch(uri);
}
async function revealSelection() {
  const relative = props.modelValue.startsWith(props.root) ? props.modelValue.slice(props.root.length) : '';
  let current = props.root;
  for (const part of relative.split('/').filter(Boolean)) {
    const next = `${current.replace(/\/$/, '')}/${encodeURIComponent(part)}/`;
    if (!branches.value[current]) await fetchBranch(current);
    current = next;
  }
}
onMounted(async () => {
  await fetchBranch(props.root);
  await revealSelection();
});
onBeforeUnmount(() => { disposed = true; });
</script>

<template>
  <div class="max-h-[min(50vh,420px)] min-h-0 overflow-auto rounded border border-base-300" aria-label="目标文件夹树">
    <template v-for="row in rows" :key="row.entry.uri + (row.more ? ':more' : '')">
      <div v-if="row.more" :style="{ paddingLeft: `${12 + row.depth * 18}px` }">
        <button type="button" class="btn btn-xs btn-ghost" :disabled="loading.has(row.entry.uri)" @click="fetchBranch(row.entry.uri, true)">加载更多</button>
      </div>
      <div v-else class="flex min-w-0 items-center gap-2 border-b border-base-300 py-2 pr-3 text-sm hover:bg-base-200" :class="modelValue === row.entry.uri ? 'bg-base-200' : ''" :style="{ paddingLeft: `${12 + row.depth * 18}px` }">
        <button type="button" class="flex h-5 w-5 shrink-0 items-center justify-center" :aria-label="expanded.has(row.entry.uri) ? '折叠文件夹' : '展开文件夹'" :aria-expanded="expanded.has(row.entry.uri)" :disabled="loading.has(row.entry.uri)" @click="toggle(row.entry.uri)">
          <ChevronDown v-if="expanded.has(row.entry.uri)" :size="14" /><ChevronRight v-else :size="14" />
        </button>
        <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" :aria-pressed="modelValue === row.entry.uri" :title="row.entry.name" @click="emit('update:modelValue', row.entry.uri)" @dblclick="toggle(row.entry.uri)">
          <component :is="expanded.has(row.entry.uri) ? FolderOpen : Folder" :size="17" class="shrink-0 text-warning" /><FileName :name="row.entry.name" />
        </button>
        <span v-if="loading.has(row.entry.uri)" class="text-xs text-base-content/60" role="status">加载中…</span>
        <button v-if="errors[row.entry.uri]" type="button" class="btn btn-xs btn-ghost text-error" @click="fetchBranch(row.entry.uri, !!cursors[row.entry.uri])">加载失败，重试</button>
      </div>
    </template>
  </div>
</template>
