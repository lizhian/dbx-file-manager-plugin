<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ArrowUp, RefreshCw, FolderPlus, Upload, Download, Pencil, Trash2, File, Folder, Image, FileText, X, Save, Search, MoreHorizontal, HardDrive } from 'lucide-vue-next';
import DirectoryTree from './DirectoryTree.vue';
import { formatSize, type Context, type Entry } from './bridge';
import { useManager, type Question } from './useManager';
const props = defineProps<{ context: Context }>();
const dialog = ref<HTMLDialogElement>();
const question = ref<Question>();
const answer = ref('');
let resolve: ((answer: string | null) => void) | undefined;
async function ask(q: Question): Promise<string | null> {
  question.value = q; answer.value = q.value || '';
  const result = new Promise<string | null>(done => { resolve = done; });
  await nextTick(); dialog.value?.showModal(); return result;
}
function finish(value: string | null) { dialog.value?.close(); resolve?.(value); resolve = undefined; question.value = undefined; }
const m = useManager(ask);
const { path, inputPath, root, selected, capabilities, busy, error, status, filter, order, tree, expanded, transfers, preview, content, dirty, rows, cursor } = m;
const menu = ref(false);
function contextMenu(entry: Entry) { if (!busy.value) { selected.value = entry; menu.value = true; } }
function icon(entry: Entry) { return entry.kind === 'directory' ? Folder : /\.(png|jpe?g|gif|webp)$/i.test(entry.name) ? Image : /\.(txt|md|json|csv|log|xml|ya?ml|toml|rs|ts|js|html|css)$/i.test(entry.name) ? FileText : File; }
function stateLabel(state: string) { return ({ queued: '排队中', running: '传输中', completed: '已完成', failed: '失败', cancelled: '已取消', cancelling: '正在取消' } as Record<string, string>)[state] || state; }
onMounted(() => void m.initialize(props.context));
onBeforeUnmount(() => resolve?.(null));
</script>

<template>
  <main class="flex h-full min-h-0 flex-col bg-base-100 text-base-content" @click="menu = false">
    <header class="flex min-h-12 flex-wrap items-center gap-2 border-b border-base-300 px-3 py-2">
      <HardDrive :size="18" class="text-success" /><h1 class="mr-auto text-sm font-semibold">文件管理 <span class="ml-2 text-xs font-normal text-base-content/60">{{ context.connectionType?.toUpperCase() }}</span></h1>
      <span v-if="capabilities.readOnly" class="text-xs text-warning">只读</span>
      <button class="btn btn-sm" :disabled="busy || !capabilities.mkdir" @click="m.mkdir"><FolderPlus :size="16" />新建目录</button>
      <button class="btn btn-sm" :disabled="busy || !capabilities.upload" @click="m.transfer(true)"><Upload :size="16" />上传</button>
      <button class="btn btn-sm" :disabled="busy || !capabilities.download || selected?.kind !== 'file'" @click="m.transfer(false)"><Download :size="16" />下载</button>
    </header>
    <form class="flex min-w-0 items-center gap-2 border-b border-base-300 px-3 py-2" @submit.prevent="m.navigate(inputPath)">
      <button type="button" class="btn btn-sm btn-square btn-ghost" title="上一级" aria-label="上一级" :disabled="busy || path === root" @click="m.up"><ArrowUp :size="16" /></button>
      <button type="button" class="btn btn-sm btn-square btn-ghost" title="刷新" aria-label="刷新" :disabled="busy" @click="m.refresh"><RefreshCw :size="16" :class="busy ? 'animate-spin' : ''" /></button>
      <input v-model="inputPath" class="input input-sm min-w-0 flex-1 font-mono" aria-label="远程路径" :disabled="busy" />
      <button class="btn btn-sm" :disabled="busy">前往</button>
    </form>
    <div v-if="error" role="alert" class="flex items-start gap-2 border-b border-error/30 bg-error/10 px-4 py-2 text-sm text-error"><span class="min-w-0 flex-1 break-words">{{ error }}</span><button class="btn btn-xs" :disabled="busy" @click="m.refresh">重试</button><button class="btn btn-xs btn-square btn-ghost" aria-label="关闭错误" @click="error = ''"><X :size="14" /></button></div>
    <div class="flex min-h-0 flex-1">
      <aside class="hidden w-48 shrink-0 overflow-auto border-r border-base-300 p-2 md:block" aria-label="目录树">
        <h2 class="px-2 py-2 text-xs font-semibold text-base-content/60">目录</h2>
        <ul><DirectoryTree :uri="root" label="根目录" :current="path" :tree="tree" :expanded="expanded" :busy="busy" @navigate="m.navigate" @toggle="m.toggleTree" /></ul>
      </aside>
      <section class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="文件列表">
        <div class="relative flex flex-wrap items-center gap-2 border-b border-base-300 px-3 py-2">
          <label class="input input-sm flex min-w-0 flex-1 items-center gap-2"><Search :size="14" class="shrink-0" /><input v-model="filter" class="min-w-0" placeholder="筛选已加载文件" aria-label="筛选文件" /></label>
          <select v-model="order" class="select select-sm w-24" aria-label="排序"><option value="name">名称</option><option value="size">大小</option></select>
          <button class="btn btn-sm btn-square btn-ghost" title="重命名" aria-label="重命名" :disabled="busy || !selected || !capabilities.rename" @click="m.rename"><Pencil :size="16" /></button>
          <button class="btn btn-sm btn-square btn-ghost" title="删除" aria-label="删除" :disabled="busy || !selected || !capabilities.delete" @click="m.remove"><Trash2 :size="16" /></button>
          <button class="btn btn-sm btn-square btn-ghost" title="更多操作" aria-label="更多操作" :disabled="busy || !selected" @click.stop="menu = !menu"><MoreHorizontal :size="16" /></button>
          <div v-if="menu" class="absolute right-3 top-full z-20 w-40 rounded border border-base-300 bg-base-100 p-1 shadow-lg" role="menu">
            <button class="btn btn-sm btn-ghost w-full justify-start" role="menuitem" :disabled="!capabilities.read" @click="selected && m.open(selected)">打开 / 预览</button>
            <button class="btn btn-sm btn-ghost w-full justify-start" role="menuitem" :disabled="!capabilities.download || selected?.kind !== 'file'" @click="m.transfer(false)"><Download :size="14" />下载</button>
            <button class="btn btn-sm btn-ghost w-full justify-start" role="menuitem" :disabled="!capabilities.rename" @click="m.rename"><Pencil :size="14" />重命名</button>
            <button class="btn btn-sm btn-ghost w-full justify-start" role="menuitem" :disabled="!capabilities.delete" @click="m.remove"><Trash2 :size="14" />删除</button>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto" :aria-busy="busy">
          <table class="table table-sm w-full table-fixed">
            <thead class="sticky top-0 z-10 bg-base-200"><tr><th class="w-auto">名称</th><th class="w-24">大小</th><th class="hidden w-40 lg:table-cell">修改时间</th></tr></thead>
            <tbody>
              <tr v-for="entry in rows" :key="entry.uri" tabindex="0" :aria-selected="selected?.uri === entry.uri" :class="selected?.uri === entry.uri ? 'bg-base-300' : 'hover:bg-base-200'" @click="!busy && (selected = entry)" @dblclick="m.open(entry)" @keydown.enter.prevent="m.open(entry)" @contextmenu.prevent.stop="contextMenu(entry)">
                <td><button class="flex w-full min-w-0 items-center gap-2 text-left" :title="entry.name" :disabled="busy" @click.stop="m.open(entry)"><component :is="icon(entry)" :size="17" class="shrink-0" :class="entry.kind === 'directory' ? 'text-warning' : 'text-base-content/60'" /><span class="truncate">{{ entry.name }}</span></button></td>
                <td class="whitespace-nowrap text-xs text-base-content/60">{{ formatSize(entry.size) }}</td><td class="hidden truncate text-xs text-base-content/60 lg:table-cell">{{ entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString('zh-CN') : '-' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="!rows.length" class="grid min-h-40 place-items-center text-sm text-base-content/50" role="status">{{ busy ? '正在加载…' : filter ? '没有匹配文件' : '目录为空' }}</div>
          <div v-if="cursor" class="p-3 text-center"><button class="btn btn-sm" :disabled="busy" @click="m.more">加载更多</button></div>
        </div>
        <footer class="flex min-h-8 items-center justify-between gap-2 border-t border-base-300 px-3 text-xs text-base-content/60"><span>{{ rows.length }} 项{{ cursor ? '（未全部加载）' : '' }}</span><span role="status">{{ status || (busy ? '处理中…' : '') }}</span></footer>
      </section>
      <section v-if="preview" class="absolute inset-0 z-30 flex min-h-0 flex-col bg-base-100 md:static md:z-auto md:w-[42%] md:min-w-72 md:border-l md:border-base-300" aria-label="文件预览">
        <div class="flex min-h-12 items-center gap-2 border-b border-base-300 px-3"><h2 class="min-w-0 flex-1 truncate text-sm font-medium" :title="preview.entry.name">{{ preview.entry.name }}<span v-if="dirty" class="ml-1 text-warning">*</span></h2><button v-if="preview.kind === 'text'" class="btn btn-sm btn-square btn-ghost" title="保存" aria-label="保存" :disabled="busy || !dirty || !capabilities.write" @click="m.save"><Save :size="16" /></button><button class="btn btn-sm btn-square btn-ghost" title="关闭预览" aria-label="关闭预览" :disabled="busy" @click="m.closePreview"><X :size="16" /></button></div>
        <textarea v-if="preview.kind === 'text'" v-model="content" class="min-h-0 w-full flex-1 resize-none bg-base-100 p-4 font-mono text-sm leading-6 outline-none" aria-label="文本内容" spellcheck="false" :readonly="busy || !capabilities.write" @keydown.meta.s.prevent="m.save" />
        <div v-else class="grid min-h-0 flex-1 place-items-center overflow-auto p-4"><img :src="preview.url" :alt="preview.entry.name" class="max-h-full max-w-full object-contain" @error="error = '图片无法解码，请下载查看。'" /></div>
        <div class="border-t border-base-300 px-3 py-2 text-xs text-base-content/60">{{ preview.kind === 'text' ? (dirty ? '未保存' : 'UTF-8') : '图片预览' }}</div>
      </section>
    </div>
    <section v-if="transfers.length" class="max-h-36 shrink-0 overflow-auto border-t border-base-300 bg-base-200 px-3 py-2" aria-label="传输任务">
      <h2 class="mb-1 text-xs font-semibold">传输任务</h2>
      <div v-for="task in transfers" :key="task.transferId" class="flex min-w-0 items-center gap-2 py-1 text-xs">
        <component :is="task.direction === 'upload' ? Upload : Download" :size="14" class="shrink-0" /><span class="min-w-0 flex-1 truncate" :title="task.uri">{{ task.uri }}</span><span :class="task.state === 'failed' ? 'text-error' : ''" :title="task.error ? JSON.stringify(task.error) : ''">{{ stateLabel(task.state) }}</span><span class="shrink-0 tabular-nums">{{ formatSize(task.bytesTransferred) }} / {{ formatSize(task.totalBytes) }}</span><button v-if="!m.terminal(task)" class="btn btn-xs btn-square btn-ghost" aria-label="取消传输" :disabled="busy" @click="m.cancel(task)"><X :size="12" /></button>
      </div>
    </section>
    <dialog ref="dialog" class="modal" @cancel.prevent="finish(null)">
      <form class="modal-box max-w-sm rounded-lg" @submit.prevent="finish(answer)">
        <h2 class="break-words text-base font-semibold">{{ question?.title }}</h2><p v-if="question?.message" class="mt-3 text-sm text-base-content/70">{{ question.message }}</p>
        <input v-if="question?.value !== undefined" v-model="answer" class="input mt-4 w-full" aria-label="名称" autofocus required />
        <div class="modal-action"><button type="button" class="btn btn-sm" @click="finish(null)">取消</button><button class="btn btn-sm" :class="question?.danger ? 'text-error' : ''">{{ question?.confirm || '确认' }}</button></div>
      </form>
    </dialog>
  </main>
</template>
