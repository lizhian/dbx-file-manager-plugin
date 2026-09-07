<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, ref } from 'vue';
import FileManager from './FileManager.vue';
import type { Context } from './bridge';
const context = shallowRef<Context>();
const error = ref('');
let unsubscribe: (() => void) | undefined;
onMounted(async () => {
  const host = window.dbxPlugin;
  if (!host) { error.value = '请在 DBX 的连接列表中打开文件连接。'; return; }
  await host.ready;
  context.value = host.context;
  unsubscribe = host.onContext(value => { context.value = value; });
});
onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <FileManager v-if="context?.connectionId" :key="`${context.connectionId}:${context.providerId}`" :context="context" />
  <main v-else class="grid h-full place-items-center p-6 text-sm text-base-content/70" role="status">{{ error || (context ? '请从宿主连接列表打开文件连接。' : '正在加载连接…') }}</main>
</template>
