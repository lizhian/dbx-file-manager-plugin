<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { middleEllipsis } from './middleEllipsis';

const props = defineProps<{ name: string }>();
const element = ref<HTMLSpanElement>();
const display = ref(props.name);
let observer: ResizeObserver | undefined;
let context: CanvasRenderingContext2D | null;

function update() {
  if (!element.value || !context) return;
  context.font = getComputedStyle(element.value).font;
  display.value = middleEllipsis(props.name, element.value.clientWidth, text => context!.measureText(text).width);
}

onMounted(() => {
  context = document.createElement('canvas').getContext('2d');
  observer = new ResizeObserver(update);
  observer.observe(element.value!);
  document.fonts.addEventListener('loadingdone', update);
  update();
});
watch(() => props.name, update, { flush: 'post' });
onBeforeUnmount(() => {
  observer?.disconnect();
  document.fonts.removeEventListener('loadingdone', update);
});
</script>

<template>
  <span ref="element" class="block min-w-0 flex-1 overflow-hidden whitespace-nowrap" :title="name" :aria-label="name">{{ display }}</span>
</template>
