<script lang="ts">
  import { ARCHIVE_FORMATS } from "$lib/constants/protocol";
  import { COPY } from "$lib/constants/copy";
  import { APP_ROUTES } from "$lib/constants/paths";
  import { archiveUrl, type TreeEntry } from "$lib/api/browser";
  import { sortEntries } from "$lib/project-page";
  import BranchSelect from "$lib/components/BranchSelect.svelte";
  import type { Project } from "$lib/api";
  import { Copy, CornerUpLeft, Download, FileText, FolderOpen, Plus, Trash2, X } from "lucide-svelte";

  // Code tab: clone URL + branch selector + ZIP/TAR + file list + README.
  // State and loaders live in the project page; this component renders only.
  let {
    project,
    isAnon,
    ref = $bindable(),
    branches,
    dirPath,
    entries,
    treeError,
    codeLoading,
    readme,
    cloneUrl,
    lfsCommandText,
    lfsThresholdMb,
    copiedClone,
    pathSegments,
    showBranchModal,
    newBranchName,
    newBranchFrom,
    branchActionError,
    creatingBranch,
    onRefChange,
    openDir,
    goToDir,
    openFile,
    copyCloneUrl,
    openBranchModal,
    closeBranchModal,
    onCreateBranch,
    onDeleteBranch,
  }: {
    project: Project;
    isAnon: boolean;
    ref: string;
    branches: string[];
    dirPath: string;
    entries: TreeEntry[];
    treeError: string;
    codeLoading: boolean;
    readme: { name: string; html: string } | null;
    cloneUrl: string;
    lfsCommandText: string;
    lfsThresholdMb: number;
    copiedClone: boolean;
    pathSegments: string[];
    showBranchModal: boolean;
    newBranchName: string;
    newBranchFrom: string;
    branchActionError: string;
    creatingBranch: boolean;
    onRefChange: () => void;
    openDir: (name: string) => void;
    goToDir: (index: number) => void;
    openFile: (name: string) => void;
    copyCloneUrl: () => void;
    openBranchModal: () => void;
    closeBranchModal: () => void;
    onCreateBranch: () => void;
    onDeleteBranch: (branch: string) => void;
  } = $props();

  const sorted = $derived(sortEntries(entries));
</script>

<div class="flex flex-col gap-4">
  <!-- Clone URL + download -->
  <div class="pixel-border bg-card p-4 flex flex-col gap-3">
    <div class="flex gap-2 items-center">
      <input class="pixel-border-sm bg-background px-3 py-1.5 text-sm flex-1 font-mono" readonly value={cloneUrl} />
      <button class="pixel-border-sm px-3 py-1.5 text-sm flex items-center gap-1.5" onclick={copyCloneUrl}>
        <Copy class="size-3.5" /> {copiedClone ? "Copied!" : "Copy"}
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <BranchSelect items={branches.length ? branches : ["HEAD"]} bind:value={ref} onselect={onRefChange} />
      {#if !isAnon}
        <button class="pixel-border-sm px-3 py-1.5 text-sm flex items-center gap-1.5" onclick={openBranchModal}>
          <Plus class="size-3.5" /> New branch
        </button>
      {/if}
      {#if !isAnon && ref !== "HEAD" && branches.includes(ref)}
        <button class="pixel-border-sm px-3 py-1.5 text-sm flex items-center gap-1.5 text-destructive" onclick={() => onDeleteBranch(ref)}>
          <Trash2 class="size-3.5" /> Delete
        </button>
      {/if}
      <a class="pixel-border-sm px-3 py-1.5 text-sm flex items-center gap-1.5 bg-card" href={archiveUrl(project.id, ref, ARCHIVE_FORMATS.ZIP.slug)}>
        <Download class="size-3.5" /> {ARCHIVE_FORMATS.ZIP.name}
      </a>
      <a class="pixel-border-sm px-3 py-1.5 text-sm flex items-center gap-1.5 bg-card" href={archiveUrl(project.id, ref, ARCHIVE_FORMATS.TAR_GZ.slug)}>
        <Download class="size-3.5" /> {ARCHIVE_FORMATS.TAR_GZ.name}
      </a>
      <span class="text-xs text-muted-foreground">username is free-form, password = git token</span>
    </div>
    {#if !isAnon}
      <details class="pixel-border-sm bg-background p-3 text-sm">
        <summary class="cursor-pointer font-bold">Git LFS setup (large files)</summary>
        <pre class="pixel-border-sm bg-card p-3 text-xs overflow-x-auto mt-2">{lfsCommandText}</pre>
        <p class="text-xs text-muted-foreground mt-2">
          Files larger than {lfsThresholdMb} MB go through LFS; patterns above match the server config. Tokens:
          <a class="underline" href={APP_ROUTES.SETTINGS}>{COPY.SETTINGS_TOKENS_LINK}</a>.
        </p>
      </details>
    {/if}
  </div>

  <!-- File browser -->
  <div class="pixel-border bg-card">
    <div class="flex items-center gap-2 px-4 py-2 border-b-2 border-border text-sm">
      {#if dirPath}
        <button class="pixel-border-sm px-2 py-0.5 text-xs flex items-center gap-1" onclick={() => goToDir(pathSegments.length - 2)}>
          <CornerUpLeft class="size-3" /> up
        </button>
        <button class="pixel-border-sm px-2 py-0.5 text-xs" onclick={() => goToDir(-1)}>root</button>
        {#each pathSegments as seg, i}
          <span class="text-muted-foreground">/</span>
          {#if i < pathSegments.length - 1}
            <button class="underline" onclick={() => goToDir(i)}>{seg}</button>
          {:else}
            <span class="font-bold">{seg}</span>
          {/if}
        {/each}
      {:else}
        <span class="font-bold">Files</span>
        <span class="text-xs text-muted-foreground ml-auto">{ref}</span>
      {/if}
    </div>

    {#if codeLoading}
      <div class="p-6 text-sm text-muted-foreground">Loading...</div>
    {:else if entries.length === 0}
      <div class="p-6 text-sm text-muted-foreground">
        {treeError || "This directory is empty."} Push commits via git to see files here.
      </div>
    {:else}
      <ul>
        {#each sorted as entry}
          <li class="border-b border-border last:border-b-0">
            {#if entry.type === "tree"}
              <button class="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted text-left" onclick={() => openDir(entry.name)}>
                <FolderOpen class="size-4 text-primary" />
                <span class="font-bold">{entry.name}</span>
                <span class="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm bg-muted">dir</span>
              </button>
            {:else}
              <button class="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted text-left" onclick={() => openFile(entry.name)}>
                <FileText class="size-4" />
                <span class="font-medium">{entry.name}</span>
                <span class="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm bg-muted">file</span>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if readme}
    <div class="pixel-border bg-card p-5 markdown-body">
      {@html readme.html}
    </div>
  {/if}

  {#if branchActionError}
    <div class="pixel-border-sm bg-background p-3 text-sm text-destructive">{branchActionError}</div>
  {/if}
</div>

{#if showBranchModal}
  <div
    class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
    role="presentation"
    onclick={(e) => { if (!creatingBranch && e.target === e.currentTarget) closeBranchModal(); }}
    onkeydown={(e) => { if (e.key === "Escape" && !creatingBranch) closeBranchModal(); }}
  >
    <div class="w-full max-w-sm bg-card p-5 pixel-border flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-bold flex-1">New branch</h2>
        <button class="pixel-border-sm px-2 py-1" onclick={closeBranchModal} disabled={creatingBranch}><X class="size-4" /></button>
      </div>
      <label class="flex flex-col gap-1 text-sm">
        Branch name
        <input
          class="pixel-border-sm bg-background px-3 py-2 text-sm font-mono"
          bind:value={newBranchName}
          placeholder="feature/my-change"
          disabled={creatingBranch}
          onkeydown={(e) => { if (e.key === "Enter") onCreateBranch(); }}
        />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        From branch
        <select class="pixel-border-sm bg-background px-3 py-2 text-sm" bind:value={newBranchFrom} disabled={creatingBranch}>
          {#each branches as b}
            <option value={b}>{b}</option>
          {/each}
        </select>
      </label>
      {#if branchActionError}
        <p class="text-sm text-destructive">{branchActionError}</p>
      {/if}
      <div class="flex gap-2 justify-end">
        <button class="pixel-border-sm px-4 py-2 text-sm" onclick={closeBranchModal} disabled={creatingBranch}>Cancel</button>
        <button
          class="pixel-border-sm px-4 py-2 text-sm bg-primary text-primary-foreground"
          disabled={creatingBranch || !newBranchName.trim()}
          onclick={onCreateBranch}
        >
          {creatingBranch ? "Creating..." : "Create branch"}
        </button>
      </div>
    </div>
  </div>
{/if}
