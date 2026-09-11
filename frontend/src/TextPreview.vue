<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
const props = defineProps<{ content: string; name: string; editable: boolean; disabled?: boolean }>();
const emit = defineEmits<{ 'update:content': [value: string] }>();
const host = ref<HTMLElement>(); let view: EditorView | undefined; const editableCompartment = new Compartment();
const languages: Record<string, () => any> = { json, js: javascript, ts: javascript, jsx: javascript, tsx: javascript, html, vue: html, css, md: markdown, markdown, py: python, rs: rust };
const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'hsl(var(--b1))', color: 'hsl(var(--bc))' },
  '.cm-gutters': { backgroundColor: 'hsl(var(--b2))', color: 'hsl(var(--bc) / 0.55)', border: 'none', borderRight: '1px solid hsl(var(--bc) / 0.18)' },
  '.cm-activeLineGutter': { backgroundColor: 'hsl(var(--b3))', color: 'hsl(var(--bc) / 0.8)' },
}, { dark: false });
function create() { if (!host.value) return; const language = languages[props.name.split('.').pop()?.toLowerCase() || '']; view = new EditorView({ state: EditorState.create({ doc: props.content, extensions: [editorTheme, lineNumbers(), history(), syntaxHighlighting(defaultHighlightStyle), ...(language ? [language()] : []), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), editableCompartment.of(EditorView.editable.of(props.editable && !props.disabled)), EditorView.updateListener.of(update => { if (update.docChanged) emit('update:content', update.state.doc.toString()); })] }), parent: host.value }); }
onMounted(create);
watch(() => props.disabled, value => view?.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(props.editable && !value)) }));
watch(() => props.content, value => { if (view && value !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } }); });
onBeforeUnmount(() => view?.destroy());
</script>
<template><div ref="host" class="min-h-0 min-w-0 flex-1 overflow-auto text-sm" :aria-label="editable ? '文本内容' : '带行号的文本预览'" /></template>
