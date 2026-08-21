<script lang="ts">
  import { onMount } from "svelte";
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import Placeholder from "@tiptap/extension-placeholder";
  import {
    Bold,
    Code,
    Code2,
    Heading1,
    Heading2,
    Heading3,
    Italic,
    Link2,
    List,
    ListOrdered,
    Minus,
    Redo2,
    Quote,
    Strikethrough,
    Underline,
    Undo2,
  } from "lucide-svelte";

  // WYSIWYG rich text editor (Tiptap, headless ProseMirror wrapper) for PR
  // descriptions, comments and review bodies. Output is HTML, sanitized
  // server-side (lib/sanitize.ts); the toolbar is fully custom so it follows
  // the neobrutalist palette. Dark mode is automatic via CSS variables.
  let {
    value,
    onChange,
    placeholder,
    rows = 3,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
  } = $props();

  let host: HTMLDivElement | undefined = $state();
  let editor: Editor | undefined = $state();
  // Bumped by every editor transaction so the toolbar re-reads isActive
  // (Svelte cannot observe ProseMirror state directly).
  let editorTick = $state(0);
  // External values are applied once, only when they actually change:
  // comparing against the serialized HTML is unsafe (an empty value
  // serializes to "<p></p>", which never equals ""), and every setContent
  // fires onTransaction (even with emitUpdate: false), which would re-run
  // the effect below forever.
  let lastApplied = $state<string | null>(null);

  onMount(() => {
    if (!host) return;
    editor = new Editor({
      element: host,
      content: value,
      extensions: [
        StarterKit.configure({
          link: { openOnClick: false },
        }),
        Placeholder.configure({ placeholder }),
      ],
      onUpdate: ({ editor }) => onChange(editor.getHTML()),
      onTransaction: () => (editorTick += 1),
      onSelectionUpdate: () => (editorTick += 1),
    });
    return () => editor?.destroy();
  });

  $effect(() => {
    // External reset (e.g. after posting a comment): apply only when the
    // value actually changed since the last application, so the mount-time
    // "" vs "<p></p>" mismatch cannot loop (every setContent fires a
    // transaction even with emitUpdate: false, re-running this effect).
    if (editor && value !== lastApplied) {
      lastApplied = value;
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  });

  // Reading editorTick inside the derived body registers it as a dependency:
  // every ProseMirror transaction rebuilds the function, so the toolbar
  // buttons re-evaluate isActive (Svelte cannot observe the editor directly).
  const isActive = $derived.by(() => {
    void editorTick;
    return (name: string, attrs?: Record<string, unknown>): boolean =>
      editor?.isActive(name, attrs) ?? false;
  });

  function toggleLink() {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = prompt(prev ? "Edit link URL" : "Link URL", prev ?? "https://");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }
</script>

<div class="rich-editor pixel-border-sm bg-card">
  <div
    class="flex flex-wrap items-center gap-1 border-b-2 border-border bg-background px-1.5 py-1"
    role="toolbar"
    aria-label="Formatting"
  >
    <button type="button" class="nb-editor-btn {isActive("bold") ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleBold().run()} title="Bold" aria-label="Bold"><Bold class="size-4" /></button>
    <button type="button" class="nb-editor-btn {isActive("italic") ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleItalic().run()} title="Italic" aria-label="Italic"><Italic class="size-4" /></button>
    <button type="button" class="nb-editor-btn {isActive("underline") ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleUnderline().run()} title="Underline" aria-label="Underline"><Underline class="size-4" /></button>
    <button type="button" class="nb-editor-btn {isActive("strike") ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleStrike().run()} title="Strikethrough" aria-label="Strikethrough"><Strikethrough class="size-4" /></button>
    <button type="button" class="nb-editor-btn {isActive("code") ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleCode().run()} title="Inline code" aria-label="Inline code"><Code class="size-4" /></button>
    <span class="nb-editor-divider" aria-hidden="true"></span>
    <button type="button" class="nb-editor-btn {isActive("heading", { level: 1 }) ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1" aria-label="Heading 1"><Heading1 class="size-4" /></button>
    <button type="button" class="nb-editor-btn {isActive("heading", { level: 2 }) ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2" aria-label="Heading 2"><Heading2 class="size-4" /></button>
    <button type="button" class="nb-editor-btn {isActive("heading", { level: 3 }) ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3" aria-label="Heading 3"><Heading3 class="size-4" /></button>
    <span class="nb-editor-divider" aria-hidden="true"></span>
    <button type="button" class="nb-editor-btn {isActive("bulletList") ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleBulletList().run()} title="Bullet list" aria-label="Bullet list"><List class="size-4" /></button>
    <button type="button" class="nb-editor-btn {isActive("orderedList") ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleOrderedList().run()} title="Numbered list" aria-label="Numbered list"><ListOrdered class="size-4" /></button>
    <button type="button" class="nb-editor-btn {isActive("blockquote") ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleBlockquote().run()} title="Quote" aria-label="Quote"><Quote class="size-4" /></button>
    <button type="button" class="nb-editor-btn {isActive("codeBlock") ? "is-active" : ""}" onclick={() => editor?.chain().focus().toggleCodeBlock().run()} title="Code block" aria-label="Code block"><Code2 class="size-4" /></button>
    <button type="button" class="nb-editor-btn {isActive("horizontalRule") ? "is-active" : ""}" onclick={() => editor?.chain().focus().setHorizontalRule().run()} title="Horizontal rule" aria-label="Horizontal rule"><Minus class="size-4" /></button>
    <span class="nb-editor-divider" aria-hidden="true"></span>
    <button type="button" class="nb-editor-btn {isActive("link") ? "is-active" : ""}" onclick={toggleLink} title="Link" aria-label="Link"><Link2 class="size-4" /></button>
    <span class="nb-editor-divider" aria-hidden="true"></span>
    <button type="button" class="nb-editor-btn" onclick={() => editor?.chain().focus().undo().run()} title="Undo" aria-label="Undo"><Undo2 class="size-4" /></button>
    <button type="button" class="nb-editor-btn" onclick={() => editor?.chain().focus().redo().run()} title="Redo" aria-label="Redo"><Redo2 class="size-4" /></button>
  </div>
  <div class="px-3 py-2" style="min-height: {rows * 40}px" bind:this={host}></div>
</div>
