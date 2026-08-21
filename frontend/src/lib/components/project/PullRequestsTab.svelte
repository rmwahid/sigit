<script lang="ts">
  import { onMount } from "svelte";
  import DiffViewer from "$lib/DiffViewer.svelte";
  import { formatDate } from "$lib/utils";
  import type { PullRequest, PullRequestDetail } from "$lib/api/pull-requests";
  import {
    MERGE_METHODS,
    PR_MERGEABLE_STATUS_BY_SLUG,
    PR_STATUSES,
    REVIEW_STATES,
    REVIEW_STATE_BY_SLUG,
    type PrStatus,
    type ReviewState,
  } from "$lib/constants/pull-requests";
  import { prMergeableBadgeClass, prMergeableLabel, prStatusBadgeClass, prStatusLabel } from "$lib/project-page";
  import { GitPullRequest, MessageSquare, Plus, X } from "lucide-svelte";
  import RichTextEditor from "$lib/components/project/RichTextEditor.svelte";

  // Pull Requests tab (Fase 3): list + create modal + detail with diff
  // preview. State lives in the page controller (lib/project-page-controller).
  let {
    pullRequests,
    prLoading,
    prError,
    activePr,
    activePrDiff,
    prDiffLoading,
    prDiffError,
    branches,
    showPrModal = $bindable(),
    newPrTitle = $bindable(),
    newPrDescription = $bindable(),
    newPrBase = $bindable(),
    newPrHead = $bindable(),
    mergeMethod = $bindable(),
    prActionError,
    creatingPr,
    canPush,
    loadPullRequests,
    openPullRequest,
    closePullRequest,
    openPrModal,
    closePrModal,
    onCreatePr,
    onUpdatePrStatus,
    onDeletePr,
    onMergePr,
    newCommentBody = $bindable(),
    reviewState = $bindable(),
    reviewSending,
    onSubmitReview,
    prFilter = $bindable(),
    onPrFilterChange,
  }: {
    pullRequests: PullRequest[];
    prLoading: boolean;
    prError: string;
    activePr: PullRequestDetail | null;
    activePrDiff: string;
    prDiffLoading: boolean;
    prDiffError: string;
    branches: string[];
    showPrModal: boolean;
    newPrTitle: string;
    newPrDescription: string;
    newPrBase: string;
    newPrHead: string;
    prFilter: PrStatus | "all";
    onPrFilterChange: () => void;
    mergeMethod: (typeof MERGE_METHODS)[keyof typeof MERGE_METHODS]["slug"];
    prActionError: string;
    creatingPr: boolean;
    canPush: boolean;
    loadPullRequests: () => void;
    openPullRequest: (number: number) => void;
    closePullRequest: () => void;
    openPrModal: () => void;
    closePrModal: () => void;
    onCreatePr: () => void;
    onUpdatePrStatus: (number: number, status: PrStatus) => void;
    onDeletePr: (number: number) => void;
    onMergePr: (number: number, method: (typeof MERGE_METHODS)[keyof typeof MERGE_METHODS]["slug"]) => void;
    newCommentBody: string;
    reviewState: ReviewState;
    reviewSending: boolean;
    onSubmitReview: (number: number) => void;
  } = $props();

  // Filter options: every status plus the "all" shortcut. Labels come from
  // the constants (slug + name), so a rename never desyncs the UI.
  const PR_FILTER_OPTIONS: { value: PrStatus | "all"; label: string }[] = [
    { value: "all", label: "All" },
    ...Object.values(PR_STATUSES).map((s) => ({ value: s.slug as PrStatus, label: s.name })),
  ];

  const MERGE_METHOD_OPTIONS = Object.values(MERGE_METHODS).map((m) => ({ value: m.slug, label: m.name }));

  const REVIEW_STATE_OPTIONS = Object.values(REVIEW_STATES).map((r) => ({ value: r.slug, label: r.name }));

  const reviewStateLabel = (state: string): string => REVIEW_STATE_BY_SLUG[state as ReviewState].name;

  const isOpen = (status: PrStatus): boolean => status === PR_STATUSES.OPEN.slug;

  // Detail body shows one section at a time so long diffs and long
  // conversations do not push each other far down the page. Resets to the
  // conversation whenever a different PR is opened (or the detail closes).
  let subTab = $state<"conversation" | "diff">("conversation");
  let subTabPrNumber = $state<number | null>(null);
  $effect(() => {
    const n = activePr?.number ?? null;
    if (n !== subTabPrNumber) {
      subTabPrNumber = n;
      subTab = "conversation";
    }
  });

  // One conversation feed: reviews and plain comments merged in
  // chronological order (the two lists are stored separately but read as one).
  type ConversationEntry =
    | { kind: "review"; id: string; state: string; body: string | null; author: { id: string; email: string }; createdAt: string }
    | { kind: "comment"; id: string; body: string; author: { id: string; email: string }; createdAt: string };

  const conversation = $derived<ConversationEntry[]>(
    activePr
      ? [
          ...activePr.reviews.map((r) => ({ kind: "review" as const, id: r.id, state: r.state, body: r.body, author: r.author, createdAt: r.createdAt })),
          ...activePr.comments.map((c) => ({ kind: "comment" as const, id: c.id, body: c.body, author: c.author, createdAt: c.createdAt })),
        ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      : []
  );

  // The tab is only mounted while active, so loading here = load on open.
  onMount(() => {
    loadPullRequests();
  });
</script>

<div class="flex flex-col gap-4">
  <!-- PR list / detail -->
  {#if activePr}
    <div class="pixel-border bg-card flex flex-col">
      <!-- Sticky header: identity, meta, and every PR action in one row so
           the merge/close controls stay reachable while scrolling a long
           diff or conversation. -->
      <div class="sticky top-4 z-10 border-b border-border bg-card px-4 py-3 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 text-sm min-w-0">
            <span class="shrink-0 size-6 flex items-center justify-center border-2 border-border bg-primary text-primary-foreground">
              <GitPullRequest class="size-4" />
            </span>
            <span class="font-bold truncate">#{activePr.number} {activePr.title}</span>
            <span class="text-xs px-2 py-0.5 border border-border rounded-sm {prStatusBadgeClass(activePr.status)}">{prStatusLabel(activePr.status)}</span>
            {#if isOpen(activePr.status)}
              <span
                class="text-xs px-2 py-0.5 border border-border rounded-sm {prMergeableBadgeClass(activePr.mergeableStatus)}"
                title="Trial merge result against the base branch"
              >{prMergeableLabel(activePr.mergeableStatus)}</span>
            {/if}
          </div>
          <button class="pixel-border-sm px-2 py-0.5 text-xs" onclick={closePullRequest}>Back</button>
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{activePr.headBranch} <span class="text-foreground font-bold">-></span> {activePr.baseBranch}</span>
          <span>by {activePr.author.email}</span>
          <span>created {formatDate(activePr.createdAt)}</span>
          {#if activePr.closedAt}<span>closed {formatDate(activePr.closedAt)}</span>{/if}
          {#if activePr.status === PR_STATUSES.MERGED.slug && activePr.mergeCommitSha}
            <span class="font-bold text-success">merged {activePr.mergeMethod ?? ""} <code>{activePr.mergeCommitSha.slice(0, 7)}</code></span>
          {/if}
        </div>
        {#if canPush && isOpen(activePr.status)}
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-bold text-muted-foreground">Actions</span>
            <select
              class="pixel-border-sm px-1.5 py-0.5 text-xs bg-background"
              bind:value={mergeMethod}
              aria-label="Merge method"
            >
              {#each MERGE_METHOD_OPTIONS as m}<option value={m.value}>{m.label}</option>{/each}
            </select>
            <button
              class="pixel-border-sm px-2 py-0.5 text-xs bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={activePr.mergeableStatus === PR_MERGEABLE_STATUS_BY_SLUG.conflict.slug}
              title={activePr.mergeableStatus === PR_MERGEABLE_STATUS_BY_SLUG.conflict.slug ? "This branch has conflicts with the base branch" : undefined}
              onclick={() => onMergePr(activePr.number, mergeMethod)}
            >Merge</button>
            <button
              class="pixel-border-sm px-2 py-0.5 text-xs"
              onclick={() => onUpdatePrStatus(activePr.number, PR_STATUSES.ABANDONED.slug)}
            >Abandon</button>
            <button
              class="pixel-border-sm px-2 py-0.5 text-xs"
              onclick={() => onUpdatePrStatus(activePr.number, PR_STATUSES.REJECTED.slug)}
            >Reject</button>
            <button
              class="pixel-border-sm px-2 py-0.5 text-xs text-destructive"
              onclick={() => onDeletePr(activePr.number)}
            >Delete</button>
          </div>
        {/if}
      </div>

      <!-- Body tabs: conversation (description + messages) or diff. Each tab
           has its own scroll length, so the other section is never buried
           below a long one. -->
      <div class="flex gap-1 border-b border-border px-4 pt-2 pb-0">
        {#each [{ key: "conversation", label: "Conversation" }, { key: "diff", label: "Diff" }] as t}
          <button
            class="px-3 py-1 text-xs font-bold border-2 border-b-0 border-border rounded-t-sm -mb-px {subTab === t.key ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}"
            onclick={() => (subTab = t.key as typeof subTab)}
          >{t.label}</button>
        {/each}
      </div>

      {#if subTab === "conversation"}
        <div class="px-4 py-3 flex flex-col gap-3">
          {#if activePr.description}
            <div class="markdown-body text-sm">{@html activePr.description}</div>
          {/if}
          <span class="text-sm font-bold">Conversation</span>
          {#if conversation.length === 0}
            <p class="text-xs text-muted-foreground">No messages yet.</p>
          {:else}
            <div class="flex flex-col gap-2">
              {#each conversation as entry}
                <div class="border border-border rounded-sm px-3 py-2 text-xs flex flex-col gap-1">
                  <div class="flex items-center gap-2">
                    {#if entry.kind === "review"}
                      <span class="px-1.5 py-0.5 border border-border rounded-sm bg-muted font-bold">
                        {reviewStateLabel(entry.state)}
                      </span>
                    {/if}
                    <span class="text-muted-foreground">{entry.author.email} {entry.kind === "review" ? "reviewed" : "commented"} {formatDate(entry.createdAt)}</span>
                  </div>
                  {#if entry.body}<div class="markdown-body">{@html entry.body}</div>{/if}
                </div>
              {/each}
            </div>
          {/if}
          {#if canPush && isOpen(activePr.status)}
            <div class="flex flex-col gap-2">
              <RichTextEditor value={newCommentBody} onChange={(v) => (newCommentBody = v)} rows={2} placeholder="Leave a comment" />
              <div class="flex items-center gap-2">
                <select class="pixel-border-sm px-1.5 py-1 text-xs bg-background" bind:value={reviewState} aria-label="Review state">
                  {#each REVIEW_STATE_OPTIONS as r}<option value={r.value}>{r.label}</option>{/each}
                </select>
                <button
                  class="pixel-border-sm px-2 py-1 text-xs flex items-center gap-1"
                  disabled={reviewSending || !newCommentBody || !newCommentBody.trim()}
                  onclick={() => onSubmitReview(activePr.number)}
                  title="Post comment or review"
                >
                  <MessageSquare class="size-3.5" /> {reviewSending ? "Posting..." : reviewStateLabel(reviewState)}
                </button>
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="px-4 py-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-bold">Diff preview</span>
            {#if prDiffLoading}<span class="text-xs text-muted-foreground">Loading...</span>{/if}
          </div>
          {#if prDiffError}
            <p class="text-xs text-destructive">{prDiffError}</p>
          {:else if !prDiffLoading && activePrDiff}
            <DiffViewer diff={activePrDiff} />
          {:else if !prDiffLoading}
            <p class="text-xs text-muted-foreground">No diff available.</p>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="pixel-border bg-card flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b border-border">
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold">Pull Requests</span>
          <select
            class="pixel-border-sm px-1.5 py-0.5 text-xs bg-background"
            bind:value={prFilter}
            onchange={() => onPrFilterChange()}
            aria-label="Filter by status"
          >
            {#each PR_FILTER_OPTIONS as o}<option value={o.value}>{o.label}</option>{/each}
          </select>
        </div>
        {#if canPush}
          <button class="pixel-border-sm px-2 py-1 text-xs flex items-center gap-1" onclick={openPrModal}>
            <Plus class="size-3.5" /> New Pull Request
          </button>
        {/if}
      </div>
      {#if prLoading}
        <div class="p-6 text-sm text-muted-foreground">Loading...</div>
      {:else if prError}
        <div class="p-6 text-sm text-destructive">{prError}</div>
      {:else if pullRequests.length === 0}
        <div class="p-6 text-sm text-muted-foreground">
          No pull requests yet. Create one to propose changes between branches.
        </div>
      {:else}
        <ul>
          {#each pullRequests as pr}
            <li class="border-b border-border last:border-b-0 px-4 py-2 flex items-center gap-3 text-sm">
              <span class="shrink-0 size-6 flex items-center justify-center border-2 border-border bg-primary text-primary-foreground">
                <GitPullRequest class="size-4" />
              </span>
              <button class="font-bold truncate flex-1 text-left hover:underline" onclick={() => openPullRequest(pr.number)}>
                #{pr.number} {pr.title}
              </button>
              <span class="text-xs px-2 py-0.5 border border-border rounded-sm {prStatusBadgeClass(pr.status)}">{prStatusLabel(pr.status)}</span>
              {#if isOpen(pr.status)}
                <span class="text-xs px-2 py-0.5 border border-border rounded-sm {prMergeableBadgeClass(pr.mergeableStatus)}">{prMergeableLabel(pr.mergeableStatus)}</span>
              {/if}
              <span class="text-xs text-muted-foreground hidden sm:inline">{pr.headBranch} <span class="text-foreground font-bold">-></span> {pr.baseBranch}</span>
              <span class="text-xs text-muted-foreground hidden md:inline">by {pr.author.email}</span>
              <span class="text-xs text-muted-foreground hidden md:inline">{formatDate(pr.createdAt)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <!-- Create PR modal -->
  {#if showPrModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div class="pixel-border bg-card w-full max-w-lg p-4 flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <span class="font-bold">New Pull Request</span>
          <button class="pixel-border-sm px-1.5 py-0.5" onclick={closePrModal} aria-label="Close">
            <X class="size-4" />
          </button>
        </div>
        <label class="flex flex-col gap-1 text-xs font-bold">
          Title
          <input
            class="pixel-border-sm px-2 py-1.5 bg-background text-sm font-normal"
            bind:value={newPrTitle}
            placeholder="Summary of the change"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs font-bold">
          Description
          <RichTextEditor value={newPrDescription} onChange={(v) => (newPrDescription = v)} rows={3} placeholder="Optional details" />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1 text-xs font-bold">
            Source (from)
            <select class="pixel-border-sm px-2 py-1.5 bg-background text-sm font-normal" bind:value={newPrHead}>
              {#each branches as b}<option value={b}>{b}</option>{/each}
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs font-bold">
            Destination (into)
            <select class="pixel-border-sm px-2 py-1.5 bg-background text-sm font-normal" bind:value={newPrBase}>
              {#each branches as b}<option value={b}>{b}</option>{/each}
            </select>
          </label>
        </div>
        {#if prActionError}
          <p class="text-xs text-destructive">{prActionError}</p>
        {/if}
        <div class="flex justify-end gap-2">
          <button class="pixel-border-sm px-3 py-1.5 text-sm" onclick={closePrModal}>Cancel</button>
          <button class="pixel-border-sm px-3 py-1.5 text-sm bg-primary text-primary-foreground" disabled={creatingPr} onclick={onCreatePr}>
            {creatingPr ? "Creating..." : "Create Pull Request"}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
