<script lang="ts">
  import { onMount } from "svelte";
  import DiffViewer from "$lib/DiffViewer.svelte";
  import { formatDate } from "$lib/utils";
  import type { PullRequest, PullRequestDetail } from "$lib/api/pull-requests";
  import { PR_STATUSES, PR_MERGEABLE_STATUSES, type ReviewState } from "$lib/constants/pull-requests";
  import { GitPullRequest, MessageSquare, Plus, ShieldCheck, X } from "lucide-svelte";

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
    commentSending,
    onAddComment,
    reviewState = $bindable(),
    reviewBody = $bindable(),
    reviewSending,
    onSubmitReview,
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
    mergeMethod: "merge" | "squash" | "fast_forward";
    prActionError: string;
    creatingPr: boolean;
    canPush: boolean;
    loadPullRequests: () => void;
    openPullRequest: (number: number) => void;
    closePullRequest: () => void;
    openPrModal: () => void;
    closePrModal: () => void;
    onCreatePr: () => void;
    onUpdatePrStatus: (number: number, status: PullRequest["status"]) => void;
    onDeletePr: (number: number) => void;
    onMergePr: (number: number, method: "merge" | "squash" | "fast_forward") => void;
    newCommentBody: string;
    commentSending: boolean;
    onAddComment: (number: number) => void;
    reviewState: ReviewState;
    reviewBody: string;
    reviewSending: boolean;
    onSubmitReview: (number: number) => void;
  } = $props();

  const statusLabel = (status: PullRequest["status"]): string =>
    PR_STATUSES[status as keyof typeof PR_STATUSES]?.name ?? status;

  const mergeableLabel = (pr: PullRequest): string =>
    pr.status !== "open"
      ? statusLabel(pr.status)
      : PR_MERGEABLE_STATUSES[pr.mergeableStatus as keyof typeof PR_MERGEABLE_STATUSES]?.name ?? pr.mergeableStatus;

  const mergeableBadgeClass = (pr: PullRequest): string => {
    if (pr.status !== "open") return "border-border bg-muted";
    if (pr.mergeableStatus === "conflict") return "border-destructive/40 bg-destructive/10 text-destructive";
    if (pr.mergeableStatus === "mergeable") return "border-primary/60 bg-muted text-primary";
    return "border-border bg-muted text-muted-foreground";
  };

  // The tab is only mounted while active, so loading here = load on open.
  onMount(() => {
    loadPullRequests();
  });
</script>

<div class="flex flex-col gap-4">
  <!-- PR list / detail -->
  {#if activePr}
    <div class="pixel-border bg-card flex flex-col">
      <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div class="flex items-center gap-2 text-sm">
          <GitPullRequest class="size-4 text-primary" />
          <span class="font-bold">#{activePr.number} {activePr.title}</span>
          <span
            class="text-xs px-2 py-0.5 border border-border rounded-sm {mergeableBadgeClass(activePr)}"
            title={activePr.status === "open" ? "Trial merge result against the base branch" : undefined}
          >{mergeableLabel(activePr)}</span>
        </div>
        <div class="flex items-center gap-2">
          {#if canPush && activePr.status === "open"}
            <select
              class="pixel-border-sm px-1.5 py-0.5 text-xs bg-background"
              bind:value={mergeMethod}
              aria-label="Merge method"
            >
              <option value="merge">Merge commit</option>
              <option value="squash">Squash</option>
              <option value="fast_forward">Fast-forward</option>
            </select>
            <button
              class="pixel-border-sm px-2 py-0.5 text-xs bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={activePr.mergeableStatus === "conflict"}
              title={activePr.mergeableStatus === "conflict" ? "This branch has conflicts with the base branch" : undefined}
              onclick={() => onMergePr(activePr.number, mergeMethod)}
            >Merge</button>
            <button
              class="pixel-border-sm px-2 py-0.5 text-xs"
              onclick={() => onUpdatePrStatus(activePr.number, "closed")}
            >Close</button>
          {/if}
          {#if canPush}
            <button
              class="pixel-border-sm px-2 py-0.5 text-xs text-destructive"
              onclick={() => onDeletePr(activePr.number)}
            >Delete</button>
          {/if}
          <button class="pixel-border-sm px-2 py-0.5 text-xs" onclick={closePullRequest}>Back</button>
        </div>
      </div>
      <div class="px-4 py-3 text-sm flex flex-col gap-2">
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{activePr.headBranch} <span class="text-foreground font-bold">-></span> {activePr.baseBranch}</span>
          <span>by {activePr.author.email}</span>
          <span>created {formatDate(activePr.createdAt)}</span>
          {#if activePr.closedAt}<span>closed {formatDate(activePr.closedAt)}</span>{/if}
          {#if activePr.status === "merged" && activePr.mergeCommitSha}
            <span class="text-primary">merged {activePr.mergeMethod ?? ""} <code>{activePr.mergeCommitSha.slice(0, 7)}</code></span>
          {/if}
        </div>
        {#if activePr.description}
          <p class="whitespace-pre-wrap text-sm">{activePr.description}</p>
        {/if}
      </div>

      <!-- Diff preview -->
      <div class="border-t border-border px-4 py-3">
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

      <!-- Conversation (comments + reviews) -->
      <div class="border-t border-border px-4 py-3 flex flex-col gap-3">
        <span class="text-sm font-bold">Conversation</span>
        {#if activePr.reviews.length > 0}
          <div class="flex flex-col gap-2">
            {#each activePr.reviews as review}
              <div class="border border-border rounded-sm px-3 py-2 text-xs flex flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="px-1.5 py-0.5 border border-border rounded-sm bg-muted font-bold">
                    {review.state === "approve" ? "Approve" : review.state === "request_changes" ? "Request changes" : "Comment"}
                  </span>
                  <span class="text-muted-foreground">{review.author.email} reviewed {formatDate(review.createdAt)}</span>
                </div>
                {#if review.body}<p class="whitespace-pre-wrap">{review.body}</p>{/if}
              </div>
            {/each}
          </div>
        {/if}
        {#if activePr.comments.length > 0}
          <div class="flex flex-col gap-2">
            {#each activePr.comments as comment}
              <div class="border border-border rounded-sm px-3 py-2 text-xs flex flex-col gap-1">
                <span class="text-muted-foreground">{comment.author.email} commented {formatDate(comment.createdAt)}</span>
                <p class="whitespace-pre-wrap">{comment.body}</p>
              </div>
            {/each}
          </div>
        {/if}
        {#if canPush}
          <div class="flex flex-col gap-2">
            <textarea
              class="pixel-border-sm px-2 py-1.5 bg-background text-sm"
              bind:value={newCommentBody}
              rows="2"
              placeholder="Leave a comment"
            ></textarea>
            <div class="flex items-center gap-2">
              <button
                class="pixel-border-sm px-2 py-1 text-xs flex items-center gap-1"
                disabled={commentSending || !newCommentBody.trim()}
                onclick={() => onAddComment(activePr.number)}
              >
                <MessageSquare class="size-3.5" /> {commentSending ? "Posting..." : "Comment"}
              </button>
              <select class="pixel-border-sm px-1.5 py-1 text-xs bg-background" bind:value={reviewState} aria-label="Review state">
                <option value="approve">Approve</option>
                <option value="request_changes">Request changes</option>
                <option value="comment">Comment</option>
              </select>
              <input
                class="pixel-border-sm px-2 py-1 text-xs bg-background flex-1 min-w-0"
                bind:value={reviewBody}
                placeholder="Review summary (optional)"
              />
              <button
                class="pixel-border-sm px-2 py-1 text-xs flex items-center gap-1"
                disabled={reviewSending}
                onclick={() => onSubmitReview(activePr.number)}
                title="Submit review (replaces your previous review)"
              >
                <ShieldCheck class="size-3.5" /> {reviewSending ? "Submitting..." : "Submit review"}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="pixel-border bg-card flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b border-border">
        <span class="text-sm font-bold">Pull Requests</span>
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
              <GitPullRequest class="size-4 text-primary shrink-0" />
              <button class="font-bold truncate flex-1 text-left hover:underline" onclick={() => openPullRequest(pr.number)}>
                #{pr.number} {pr.title}
              </button>
              <span class="text-xs px-2 py-0.5 border border-border rounded-sm {mergeableBadgeClass(pr)}">{mergeableLabel(pr)}</span>
              <span class="text-xs text-muted-foreground hidden sm:inline">{pr.headBranch} -> {pr.baseBranch}</span>
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
          <textarea
            class="pixel-border-sm px-2 py-1.5 bg-background text-sm font-normal"
            bind:value={newPrDescription}
            rows="3"
            placeholder="Optional details (plain text)"
          ></textarea>
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1 text-xs font-bold">
            Base branch
            <select class="pixel-border-sm px-2 py-1.5 bg-background text-sm font-normal" bind:value={newPrBase}>
              {#each branches as b}<option value={b}>{b}</option>{/each}
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs font-bold">
            Head branch
            <select class="pixel-border-sm px-2 py-1.5 bg-background text-sm font-normal" bind:value={newPrHead}>
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
