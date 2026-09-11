<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronLeft, ChevronRight, ChevronDown, RefreshCw, FolderPlus, Upload, Download, FilePenLine, Trash2, File, FileText, Image, Folder, FolderOpen, Eye, Copy, X, Save, CheckCircle2, CircleAlert } from 'lucide-vue-next';
import { formatSize, parentUri, type Context, type Entry } from './bridge';
import { useManager, type Question } from './useManager';
import FileName from './FileName.vue';
import FolderPicker from './FolderPicker.vue';
import TextPreview from './TextPreview.vue';
const props = defineProps<{ context: Context }>();
const dialog = ref<HTMLDialogElement>(), question = ref<Question>(), answer = ref('');
let resolve: ((answer: string | null) => void) | undefined;
async function ask(q: Question) {
  question.value = q; answer.value = q.value || '';
  const result = new Promise<string | null>(done => { resolve = done; });
  await nextTick(); dialog.value?.showModal(); return result;
}
function finish(value: string | null) { dialog.value?.close(); resolve?.(value); resolve = undefined; question.value = undefined; }
const m = useManager(ask);
const { path, root, selected, capabilities, busy, error, status, expanded, transfers, preview, content, dirty, tableRows, cursor, generic, inputPath } = m;
const downloadsOpen = ref(false), menu = ref<{ x: number; y: number }>();
const editing = ref<Entry>(); const editFolder = ref(''); const editName = ref('');
const folderAction = ref<'mkdir' | 'upload'>();
function startEdit(entry: Entry) { editing.value = entry; editFolder.value = parentUri(entry.uri); editName.value = entry.name; selected.value = entry; menu.value = undefined; }
function cancelEdit() { editing.value = undefined; }
function startFolderAction(action: 'mkdir' | 'upload') { folderAction.value = action; editFolder.value = path.value; editName.value = ''; }
function cancelFolderAction() { folderAction.value = undefined; }
async function finishFolderAction() { const action = folderAction.value; const target = editFolder.value; cancelFolderAction(); if (action === 'mkdir') { selected.value = undefined; await m.mkdirAt(target, editName.value.trim()); } else await m.transfer(true, target); }
async function copyPath(entry: Entry) { const value = decodeURIComponent(entry.uri.replace(/^[^:]+:/, '')); try { await navigator.clipboard.writeText(value); status.value = '路径已复制'; } catch { await ask({ title: '复制路径失败', message: value, confirm: '知道了' }); } }
const displayPath = computed(() => { try { return decodeURIComponent(path.value.replace(/^[^:]+:/, '')) || '/'; } catch { return path.value; } });
let clickTimer: ReturnType<typeof setTimeout> | undefined;
function cancelClick() { clearTimeout(clickTimer); }
function entryClick(entry: Entry, event: MouseEvent) {
  if (busy.value || event.detail > 1) return;
  cancelClick(); selected.value = entry;
  clickTimer = setTimeout(() => { if (entry.kind === 'directory') void m.toggleTree(entry.uri); else if (entry.kind === 'file') void action(entry, 'preview'); }, 250);
}
function icon(entry: Entry) { return entry.kind === 'directory' ? expanded.value.has(entry.uri) ? FolderOpen : Folder : /\.(png|jpe?g|gif|webp)$/i.test(entry.name) ? Image : /\.(txt|md|json|csv|log|xml|ya?ml|toml|rs|ts|js|html|css)$/i.test(entry.name) ? FileText : File; }
function doubleClick(entry: Entry) { cancelClick(); if (entry.kind === 'directory') void m.navigate(entry.uri); else void m.open(entry); }
async function action(entry: Entry, operation: 'rename' | 'delete' | 'copy' | 'download' | 'preview') {
  cancelClick(); if (busy.value) return;
  selected.value = entry; menu.value = undefined;
  if (operation === 'download') { await m.transfer(false); if (transfers.value.length) downloadsOpen.value = true; }
  else if (operation === 'preview') await m.open(entry);
  else if (operation === 'delete') await m.remove();
  else if (operation === 'copy') await m.copy();
  else await m.rename();
}
function contextMenu(entry: Entry, event: MouseEvent) {
  cancelClick(); if (busy.value) return; selected.value = entry;
  menu.value = { x: Math.max(0, Math.min(event.clientX, innerWidth - 180)), y: Math.max(0, Math.min(event.clientY, innerHeight - 220)) };
}
function stateLabel(state: string) { return ({ queued: '排队中', running: '传输中', completed: '已完成', failed: '失败', cancelled: '已取消', cancelling: '正在取消' } as Record<string, string>)[state] || state; }
function taskName(uri: string) { const value = uri.split('/').filter(Boolean).pop() || uri; try { return decodeURIComponent(value); } catch { return value; } }
onMounted(() => void m.initialize(props.context));
onBeforeUnmount(() => { cancelClick(); resolve?.(null); });
</script>

<template>
  <main class="relative flex h-full min-h-0 flex-col bg-base-100 text-base-content" @click="menu = undefined; downloadsOpen = false" @keydown.esc="menu = undefined; downloadsOpen = false">
    <header class="relative z-20 flex min-h-12 flex-wrap items-center gap-1 border-b border-base-300 px-3 py-2">
      <button class="btn btn-sm btn-square btn-ghost" title="上一级" aria-label="上一级" :disabled="busy || path === root" @click="m.up"><ChevronLeft :size="17" /></button>
      <button class="btn btn-sm btn-square btn-ghost" title="刷新" aria-label="刷新" :disabled="busy" @click="m.refresh"><RefreshCw :size="18" :class="busy ? 'animate-spin' : ''" /></button>
      <span v-if="!generic" class="min-w-0 flex-1 truncate px-2 text-sm" :title="displayPath" aria-label="当前路径">{{ displayPath }}</span>
      <form v-if="generic" class="flex min-w-0 flex-1 items-center gap-1" @submit.prevent="m.accessPath('directory')">
        <input v-model="inputPath" class="input input-sm min-w-0 w-full focus:outline-none focus:ring-0" aria-label="存储路径" :readonly="busy" @keydown.enter.prevent="m.accessPath('directory')" />
        <button type="button" class="btn btn-sm btn-square btn-ghost" title="进入目录" aria-label="进入目录" :disabled="busy" @click="m.accessPath('directory')"><FolderOpen :size="16" /></button>
      </form>
      <span v-if="capabilities.readOnly" class="px-2 text-xs text-warning">只读</span>
      <div class="ml-auto flex flex-wrap justify-end gap-1 max-sm:w-full">
        <button class="btn btn-sm btn-outline border-base-300" :disabled="busy || capabilities.readOnly || (!generic && !capabilities.mkdir)" @click="startFolderAction('mkdir')"><FolderPlus :size="16" />新建文件夹</button>
        <button class="btn btn-sm btn-outline border-base-300" :disabled="busy || capabilities.readOnly || (!generic && !capabilities.upload)" @click="startFolderAction('upload')"><Upload :size="16" />上传</button>
        <button class="btn btn-sm btn-outline border-base-300" :class="downloadsOpen ? 'bg-base-200' : ''" :aria-expanded="downloadsOpen" aria-controls="transfer-list" @click.stop="downloadsOpen = !downloadsOpen"><Download :size="16" />传输列表</button>
      </div>
      <section v-if="downloadsOpen" id="transfer-list" class="absolute right-2 top-full z-30 w-[520px] max-w-[calc(100vw-16px)] rounded-lg border border-base-300 bg-base-100 shadow-lg" aria-label="传输列表" @click.stop>
        <h2 class="border-b border-base-300 px-4 py-3 text-sm font-semibold">传输列表</h2>
        <div class="max-h-72 overflow-auto p-3"><p v-if="!transfers.length" class="py-4 text-center text-sm text-base-content/60">暂无传输任务</p>
          <div v-for="task in transfers" :key="task.transferId" class="flex min-w-0 items-center gap-2 py-2 text-xs">
            <CheckCircle2 v-if="task.state === 'completed'" :size="16" class="shrink-0 text-success" /><CircleAlert v-else-if="task.state === 'failed'" :size="16" class="shrink-0 text-error" /><RefreshCw v-else :size="16" class="shrink-0" :class="!m.terminal(task) ? 'animate-spin' : ''" />
            <component :is="task.direction === 'upload' ? Upload : Download" :size="16" class="shrink-0 text-base-content/60" :title="task.direction === 'upload' ? '上传' : '下载'" /><span class="min-w-0 flex-1 truncate font-medium" :title="task.uri">{{ taskName(task.uri) }}</span>
            <span class="shrink-0 text-base-content/60" :title="task.error ? JSON.stringify(task.error) : ''">{{ stateLabel(task.state) }}</span><span class="shrink-0 tabular-nums text-base-content/60">{{ formatSize(task.bytesTransferred) }}</span>
            <button v-if="!m.terminal(task)" class="btn btn-xs btn-square btn-ghost" title="取消传输" aria-label="取消传输" :disabled="busy" @click="m.cancel(task)"><X :size="14" /></button>
            <template v-if="task.direction === 'download' && task.state === 'completed'">
              <button class="btn btn-xs btn-square btn-ghost" title="打开文件" aria-label="打开文件" :disabled="busy || !m.localTokens.value[task.transferId]" @click="m.openLocal(task, false)"><File :size="16" /></button>
              <button class="btn btn-xs btn-square btn-ghost" title="打开所在文件夹" aria-label="打开所在文件夹" :disabled="busy || !m.localTokens.value[task.transferId]" @click="m.openLocal(task, true)"><FolderOpen :size="16" /></button>
            </template>
          </div>
        </div>
      </section>
    </header>
    <div v-if="error" role="alert" class="flex items-center gap-2 border-b border-error/30 bg-error/10 px-3 py-2 text-sm text-error"><span class="min-w-0 flex-1 break-words">{{ error }}</span><button class="btn btn-xs" :disabled="busy" @click="m.refresh">重试</button><button class="btn btn-xs btn-square btn-ghost" aria-label="关闭错误" @click="error = ''"><X :size="14" /></button></div>
    <div class="flex min-h-0 flex-1">
      <section class="min-h-0 min-w-0 flex-1 overflow-auto" aria-label="文件列表" :aria-busy="busy">
        <table class="table table-sm w-full min-w-[420px] table-fixed">
          <thead class="sticky top-0 z-10 bg-base-200"><tr><th>名称</th><th class="hidden w-24 text-right sm:table-cell">大小</th><th class="hidden w-44 lg:table-cell">修改时间</th><th class="w-40 text-right">操作</th></tr></thead>
          <tbody>
            <tr v-if="path !== root" class="cursor-pointer border-b border-base-300 hover:bg-base-200" @dblclick="m.up"><td><span class="flex items-center gap-2"><ChevronLeft :size="16" /><FolderOpen :size="17" class="text-warning" />../</span></td><td class="hidden sm:table-cell" /><td class="hidden lg:table-cell" /><td /></tr>
            <tr v-for="row in tableRows" :key="row.entry.uri + (row.more ? ':more' : '')" class="border-b border-base-300 hover:bg-base-200" :data-file-entry-path="row.entry.uri" :aria-selected="selected?.uri === row.entry.uri" tabindex="0" @click="!row.more && entryClick(row.entry, $event)" @dblclick="!row.more && doubleClick(row.entry)" @keydown.enter.prevent="!row.more && doubleClick(row.entry)" @contextmenu.prevent.stop="!row.more && contextMenu(row.entry, $event)">
              <td :style="{ paddingLeft: `${12 + row.depth * 18}px` }"><button v-if="row.more" class="btn btn-xs btn-ghost" :disabled="busy" @click.stop="m.toggleTree(row.entry.uri, true)">加载更多</button>
                <span v-else class="flex min-w-0 items-center gap-2" :title="row.entry.name">
                  <button v-if="row.entry.kind === 'directory'" class="flex h-5 w-5 shrink-0 items-center justify-center" :aria-expanded="expanded.has(row.entry.uri)" :aria-label="expanded.has(row.entry.uri) ? '折叠文件夹' : '展开文件夹'" :disabled="busy" @click.stop="cancelClick(); m.toggleTree(row.entry.uri)"><ChevronDown v-if="expanded.has(row.entry.uri)" :size="14" /><ChevronRight v-else :size="14" /></button><span v-else class="w-5 shrink-0" />
                  <component :is="icon(row.entry)" :size="17" class="shrink-0" :class="row.entry.kind === 'directory' ? 'text-warning' : 'text-base-content/60'" /><FileName :name="row.entry.name" />
                </span>
              </td>
              <td class="hidden text-right text-xs tabular-nums text-base-content/60 sm:table-cell">{{ row.more ? '' : row.entry.kind === 'file' ? formatSize(row.entry.size) : '—' }}</td>
              <td class="hidden truncate text-xs text-base-content/60 lg:table-cell">{{ row.more ? '' : row.entry.modifiedAt ? new Date(row.entry.modifiedAt).toLocaleString('zh-CN') : '—' }}</td>
              <td class="text-right"><div v-if="!row.more" class="flex justify-end">
                <button v-if="row.entry.kind === 'file'" class="btn btn-xs btn-square btn-ghost" title="下载" aria-label="下载" :disabled="busy || (!generic && !capabilities.download)" @click.stop="action(row.entry, 'download')"><Download :size="16" /></button>
                <button class="btn btn-xs btn-square btn-ghost" title="复制路径" aria-label="复制路径" :disabled="busy" @click.stop="copyPath(row.entry)"><Copy :size="16" /></button>
                <button class="btn btn-xs btn-square btn-ghost" title="编辑" aria-label="编辑" :disabled="busy || capabilities.readOnly || (!generic && !capabilities.rename)" @click.stop="startEdit(row.entry)"><FilePenLine :size="16" /></button>
                <button class="btn btn-xs btn-square btn-ghost text-error" title="删除" aria-label="删除" :disabled="busy || capabilities.readOnly || (!generic && !capabilities.delete)" @click.stop="action(row.entry, 'delete')"><Trash2 :size="16" /></button>
              </div></td>
            </tr>
          </tbody>
        </table>
        <p v-if="!tableRows.length" class="p-8 text-center text-sm text-base-content/60" role="status">{{ busy ? '正在加载…' : capabilities.list === false ? '此服务不支持目录浏览' : '目录为空' }}</p><div v-if="cursor" class="p-3 text-center"><button class="btn btn-sm" :disabled="busy" @click="m.more">加载更多</button></div>
      </section>
      <section v-if="preview" class="absolute inset-0 z-30 flex min-h-0 flex-col bg-base-100 md:static md:z-auto md:w-[42%] md:min-w-72 md:border-l md:border-base-300" aria-label="文件预览">
        <div class="flex h-[37px] min-h-[37px] shrink-0 items-center gap-2 border-b border-base-300 px-3"><h2 class="min-w-0 flex-1 truncate text-sm font-medium" :title="preview.entry.name">{{ preview.entry.name }}<span v-if="dirty" class="ml-1 text-warning">*</span></h2><button v-if="preview.kind === 'text' && !preview.truncated && preview.editable !== false" class="btn btn-sm btn-square btn-ghost" title="保存" aria-label="保存" :disabled="busy || !dirty || !capabilities.write" @click="m.save"><Save :size="16" /></button><button class="btn btn-sm btn-square btn-ghost" title="关闭预览" aria-label="关闭预览" :disabled="busy" @click="m.closePreview"><X :size="16" /></button></div>
        <TextPreview v-if="preview.kind === 'text'" v-model:content="content" :name="preview.entry.name" :editable="!preview.truncated && preview.editable !== false && capabilities.write" :disabled="busy" @keydown.meta.s.prevent="m.save" @keydown.ctrl.s.prevent="m.save" />
        <div v-else class="grid min-h-0 flex-1 place-items-center overflow-auto p-4"><img :src="preview.url" :alt="preview.entry.name" class="max-h-full max-w-full object-contain" @error="error = '图片无法解码，请下载查看。'" /></div>
        <div class="border-t border-base-300 px-3 py-2 text-xs text-base-content/60">{{ preview.kind === 'text' ? (preview.truncated ? (preview.byteLimited ? '只读预览：最多前 1000 行，已达到 20 MiB 上限' : '只读预览：仅显示前 1000 行，最多 20 MiB') : preview.editable === false ? '只读预览' : dirty ? '未保存' : 'UTF-8') : '图片预览' }}</div>
      </section>
    </div>
    <div v-if="status" role="status" class="absolute bottom-3 left-3 rounded border border-base-300 bg-base-100 px-3 py-2 text-xs shadow">{{ status }}</div>
    <div v-if="menu && selected" class="fixed z-40 w-44 rounded border border-base-300 bg-base-100 p-1 shadow-lg" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" role="menu" @click.stop>
      <button class="btn btn-sm btn-ghost w-full justify-start" role="menuitem" :disabled="busy" @click="m.open(selected); menu = undefined">{{ selected.kind === 'directory' ? '进入文件夹' : '预览' }}</button>
      <button v-if="selected.kind === 'file'" class="btn btn-sm btn-ghost w-full justify-start" role="menuitem" :disabled="busy || (!generic && !capabilities.download)" @click="action(selected, 'download')">下载</button>
      <button class="btn btn-sm btn-ghost w-full justify-start" role="menuitem" :disabled="busy" @click="copyPath(selected); menu = undefined">复制路径</button>
      <button class="btn btn-sm btn-ghost w-full justify-start" role="menuitem" :disabled="busy || capabilities.readOnly || (!generic && !capabilities.rename)" @click="startEdit(selected)">编辑</button><button class="btn btn-sm btn-ghost w-full justify-start text-error" role="menuitem" :disabled="busy || capabilities.readOnly || (!generic && !capabilities.delete)" @click="action(selected, 'delete')">删除</button>
    </div>
    <dialog v-if="editing" open class="modal"><div class="modal-box flex h-auto max-h-[85vh] max-w-2xl flex-col gap-3"><h2 class="flex shrink-0 items-center gap-3 text-base font-semibold"><span>{{ editing.kind === "file" ? "文件夹树" : "重命名" }}</span><span v-if="editing.kind === 'file'" class="min-w-0 truncate text-sm font-normal text-base-content/60" :title="editFolder">{{ editFolder.replace(root, '') || '/' }}</span></h2><FolderPicker v-if="editing.kind === 'file'" :key="editing.uri" v-model="editFolder" :root="root" :load="m.listDirectories" /><input v-model="editName" class="input input-sm w-full shrink-0 focus:outline-none focus:ring-0" aria-label="文件名称" placeholder="文件名称" /><div class="modal-action mt-0 shrink-0"><button class="btn btn-sm" @click="cancelEdit">取消</button><button v-if="editing.kind === 'file'" class="btn btn-sm" :disabled="!editName.trim()" @click="m.copyTo(editFolder, false, editName.trim()); cancelEdit()">复制</button><button v-if="editFolder !== parentUri(editing.uri) && editing.kind === 'file'" class="btn btn-sm" :disabled="!editName.trim()" @click="m.copyTo(editFolder, true, editName.trim()); cancelEdit()">移动</button><button v-if="editFolder === parentUri(editing.uri)" class="btn btn-sm" :disabled="!editName.trim()" @click="m.rename(editName.trim()); cancelEdit()">重命名</button></div></div></dialog>
    <dialog ref="dialog" class="modal" @cancel.prevent="finish(null)"><form class="modal-box max-w-sm rounded-lg" @submit.prevent="finish(answer)">
      <h2 class="break-words text-base font-semibold">{{ question?.title }}</h2><p v-if="question?.message" class="mt-3 text-sm text-base-content/70">{{ question.message }}</p><input v-if="question?.value !== undefined" v-model="answer" class="input input-sm mt-4 w-full focus:outline-none focus:ring-0" aria-label="名称" autofocus required @keydown.enter.prevent="answer.trim() && finish(answer)" />
      <div class="modal-action"><button type="button" class="btn btn-sm" @click="finish(null)">取消</button><button type="button" class="btn btn-sm" :disabled="question?.value !== undefined && !answer.trim()" :class="question?.danger ? 'text-error' : ''" @click="finish(answer)">{{ question?.confirm || '确认' }}</button></div>
    </form></dialog>
    <dialog v-if="folderAction" open class="modal"><div class="modal-box flex h-auto max-h-[85vh] max-w-2xl flex-col gap-3"><h2 class="text-base font-semibold">{{ folderAction === 'mkdir' ? '选择新建目录位置' : '选择上传目录' }}</h2><FolderPicker v-model="editFolder" :root="root" :load="m.listDirectories" /><input v-if="folderAction === 'mkdir'" v-model="editName" class="input input-sm w-full focus:outline-none focus:ring-0" aria-label="文件夹名称" placeholder="文件夹名称" /><div class="modal-action mt-0"><button class="btn btn-sm" @click="cancelFolderAction">取消</button><button class="btn btn-sm" :disabled="folderAction === 'mkdir' && !editName.trim()" @click="finishFolderAction">{{ folderAction === 'mkdir' ? '新建' : '选择文件' }}</button></div></div></dialog>
  </main>
</template>
