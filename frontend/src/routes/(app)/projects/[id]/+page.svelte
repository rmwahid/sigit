<script lang="ts">
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { APP_ROUTES } from "$lib/constants/paths";
  import { MAX_FILE_BROWSER_BYTES } from "$lib/constants/validation";
  import { ProjectPageController } from "$lib/project-page-controller.svelte";
  import type { ProjectTabKey } from "$lib/project-page";
  import CodeTab from "$lib/components/project/CodeTab.svelte";
  import HistoryTab from "$lib/components/project/HistoryTab.svelte";
  import ActivityTab from "$lib/components/project/ActivityTab.svelte";
  import PullRequestsTab from "$lib/components/project/PullRequestsTab.svelte";
  import SettingsTab from "$lib/components/project/SettingsTab.svelte";
  import TabLoading from "$lib/components/project/TabLoading.svelte";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import {
    Activity as ActivityIcon,
    FileText,
    Folder,
    GitBranch,
    GitPullRequest,
    History as HistoryIcon,
    Settings as SettingsIcon,
    X,
  } from "lucide-svelte";

  // Thin view: all state and loaders live in the controller (paired with the
  // pure helpers in lib/project-page which have tests).
  const ctrl = new ProjectPageController();

  // Active tab chips cycle through the accent colors on every click, so the
  // tab bar does not read as one flat color. Each click rolls a fresh pick.
  const TAB_ACCENTS = ["bg-primary text-primary-foreground", "bg-accent text-accent-foreground", "bg-secondary text-secondary-foreground"] as const;
  let activeAccent: string = $state(TAB_ACCENTS[0]);
  const pickAccent = () => {
    activeAccent = TAB_ACCENTS[Math.floor(Math.random() * TAB_ACCENTS.length)];
  };

  const TAB_META: Record<ProjectTabKey, { label: string; icon: typeof Folder }> = {
    code: { label: "Code", icon: Folder },
    history: { label: "History", icon: HistoryIcon },
    activity: { label: "Activity", icon: ActivityIcon },
    "pull-requests": { label: "Pull Requests", icon: GitPullRequest },
    settings: { label: "Settings", icon: SettingsIcon },
  };
  const tabs = $derived(ctrl.tabKeys.map((key) => ({ key, ...TAB_META[key] })));

  $effect(() => {
    if (!ctrl.tabKeys.includes(ctrl.tab)) ctrl.tab = "code";
  });

  // Reload on param change (SvelteKit reuses this component across /projects/[id]).
  $effect(() => {
    const id = $page.params.id;
    if (id) void ctrl.init(id);
  });

  onMount(() => void ctrl.loadAppInfo());
</script>

<svelte:head>
  <title>{ctrl.project?.name ?? "Project"} - SiGit</title>
</svelte:head>

{#if !ctrl.project}
  <p class="text-muted-foreground">{ctrl.error || "Loading..."}</p>
{:else}
  <div class="max-w-4xl mx-auto flex flex-col gap-4">
    <!-- Breadcrumb + header -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        {#if ctrl.isAnon}
          <a href={APP_ROUTES.EXPLORE} class="font-bold text-foreground">Explore</a>
        {:else}
          <a href={APP_ROUTES.ROOT} class="font-bold text-foreground">Projects</a>
        {/if}
        <span>/</span>
        <span class="font-bold text-foreground">{ctrl.project.name}</span>
        {#if ctrl.project.isPublic}
          <span class="ml-1 text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm bg-accent text-accent-foreground">public</span>
        {/if}
      </div>
      <h1 class="flex items-center gap-2 text-2xl font-extrabold">
        <GitBranch class="size-6 text-vivid" />
        <span class="nb-mark">{ctrl.project.name}</span>
      </h1>
      {#if ctrl.project.description}
        <p class="text-sm text-muted-foreground">{ctrl.project.description}</p>
      {/if}
    </div>

    {#if ctrl.error}<div class="p-2 border border-destructive text-destructive text-sm">{ctrl.error}</div>{/if}
    {#if ctrl.message}<div class="p-2 border border-border bg-accent text-accent-foreground text-sm">{ctrl.message}</div>{/if}

    <!-- Tab bar -->
    <div class="flex gap-1 border-b-2 border-border">
      {#each tabs as t}
        <button
          class="px-4 py-1.5 text-sm font-bold flex items-center gap-1.5 border-2 border-b-0 border-border rounded-t-sm transition-all {ctrl.tab === t.key ? activeAccent + " -mb-0.5" : "bg-card hover:bg-muted"}"
          onclick={() => {
            ctrl.tab = t.key;
            pickAccent();
            ctrl.ensureTabLoaded(t.key);
          }}
        >
          <t.icon class="size-3.5" /> {t.label}
        </button>
      {/each}
    </div>

    {#if ctrl.tab === "code"}
      <CodeTab
        project={ctrl.project}
        isAnon={ctrl.isAnon}
        bind:ref={ctrl.ref}
        branches={ctrl.branches}
        dirPath={ctrl.dirPath}
        entries={ctrl.entries}
        treeError={ctrl.treeError}
        codeLoading={ctrl.codeLoading}
        readme={ctrl.readme}
        cloneUrl={ctrl.cloneUrl}
        lfsCommandText={ctrl.lfsCommandText}
        lfsThresholdMb={ctrl.lfsThresholdMb}
        copiedClone={ctrl.copiedClone}
        pathSegments={ctrl.pathSegments}
        showBranchModal={ctrl.showBranchModal}
        newBranchName={ctrl.newBranchName}
        newBranchFrom={ctrl.newBranchFrom}
        branchActionError={ctrl.branchActionError}
        creatingBranch={ctrl.creatingBranch}
        onRefChange={() => void ctrl.onRefChange()}
        openDir={(name) => void ctrl.openDir(name)}
        goToDir={(i) => void ctrl.goToDir(i)}
        openFile={(name) => void ctrl.openFile(name)}
        copyCloneUrl={() => void ctrl.copyCloneUrl()}
        openBranchModal={() => ctrl.openBranchModal()}
        closeBranchModal={() => ctrl.closeBranchModal()}
        onCreateBranch={() => void ctrl.onCreateBranch()}
        onDeleteBranch={(branch) => void ctrl.onDeleteBranch(branch)}
      />
    {:else if ctrl.tab === "history"}
      {#if !ctrl.loadedTabs.history && ctrl.historyLoading}
        <TabLoading label="Loading history" />
      {:else}
        <HistoryTab
          history={ctrl.history}
          historyMore={ctrl.historyMore}
          historyLoading={ctrl.historyLoading}
          diff={ctrl.diff}
          isAnon={ctrl.isAnon}
          showDiff={(hash) => void ctrl.showDiff(hash)}
          loadMore={() => void ctrl.loadHistory(true)}
          closeDiff={() => ctrl.closeDiff()}
          branches={ctrl.branches}
          bind:ref={ctrl.ref}
          onRefChange={() => void ctrl.onRefChange()}
        />
      {/if}
    {:else if ctrl.tab === "activity"}
      {#if !ctrl.loadedTabs.activity && ctrl.activityLoading}
        <TabLoading label="Loading activity" />
      {:else}
        <ActivityTab
          activityByDate={ctrl.activityByDate}
          activityMore={ctrl.activityMore}
          activityLoading={ctrl.activityLoading}
          loadMore={() => void ctrl.loadActivity(true)}
        />
      {/if}
    {:else if ctrl.tab === "pull-requests"}
      {#if !ctrl.loadedTabs["pull-requests"] && ctrl.prLoading}
        <TabLoading label="Loading pull requests" />
      {:else}
        <PullRequestsTab
          pullRequests={ctrl.pullRequests}
          prLoading={ctrl.prLoading}
          prError={ctrl.prError}
          activePr={ctrl.activePr}
          activePrDiff={ctrl.activePrDiff}
          prDiffLoading={ctrl.prDiffLoading}
          prDiffError={ctrl.prDiffError}
          branches={ctrl.branches}
          bind:showPrModal={ctrl.showPrModal}
          bind:newPrTitle={ctrl.newPrTitle}
          bind:newPrDescription={ctrl.newPrDescription}
          bind:newPrBase={ctrl.newPrBase}
          bind:newPrHead={ctrl.newPrHead}
          bind:mergeMethod={ctrl.mergeMethod}
          prActionError={ctrl.prActionError}
          creatingPr={ctrl.creatingPr}
          canPush={ctrl.hasPerm("push")}
          loadPullRequests={() => void ctrl.loadPullRequests()}
          openPullRequest={(number) => void ctrl.openPullRequest(number)}
          closePullRequest={() => ctrl.closePullRequest()}
          openPrModal={() => ctrl.openPrModal()}
          closePrModal={() => ctrl.closePrModal()}
          onCreatePr={() => void ctrl.onCreatePr()}
          onUpdatePrStatus={(number, status) => void ctrl.onUpdatePrStatus(number, status)}
          onDeletePr={(number) => void ctrl.onDeletePr(number)}
          onMergePr={(number, method) => void ctrl.onMergePr(number, method)}
          bind:newCommentBody={ctrl.newCommentBody}
          bind:reviewState={ctrl.reviewState}
          reviewSending={ctrl.reviewSending}
          onSubmitReview={(number) => void ctrl.onSubmitReview(number)}
          bind:prFilter={ctrl.prFilter}
          onPrFilterChange={() => void ctrl.onPrFilterChange()}
        />
        <ConfirmModal
          open={ctrl.confirmState !== null}
          title={ctrl.confirmState?.title ?? ""}
          message={ctrl.confirmState?.message ?? ""}
          confirmLabel={ctrl.confirmState?.confirmLabel ?? "Confirm"}
          danger={ctrl.confirmState?.danger ?? false}
          onConfirm={() => ctrl.confirmConfirm()}
          onCancel={() => ctrl.cancelConfirm()}
        />
      {/if}
    {:else if ctrl.tab === "settings"}
      {#if !ctrl.loadedTabs.settings && ctrl.settingsLoading}
        <TabLoading label="Loading settings" />
      {:else}
        <SettingsTab
        project={ctrl.project}
        connections={ctrl.connections}
        bind:connTab={ctrl.connTab}
        bind:selectedConnId={ctrl.selectedConnId}
        connecting={ctrl.connecting}
        backingUp={ctrl.backingUp}
        collaborators={ctrl.collaborators}
        allUsers={ctrl.allUsers}
        bind:newCollabUserId={ctrl.newCollabUserId}
        bind:newCollabPerms={ctrl.newCollabPerms}
        bind:editingCollab={ctrl.editingCollab}
        bind:editingPerms={ctrl.editingPerms}
        projectTokens={ctrl.projectTokens}
        protectionRules={ctrl.protectionRules}
        protectionLoading={ctrl.protectionLoading}
        protectionError={ctrl.protectionError}
        bind:showProtectionModal={ctrl.showProtectionModal}
        protectionSaving={ctrl.protectionSaving}
        bind:newProtectionPattern={ctrl.newProtectionPattern}
        bind:newProtectionRequirePr={ctrl.newProtectionRequirePr}
        bind:newProtectionApprovals={ctrl.newProtectionApprovals}
        bind:newProtectionBlockRequest={ctrl.newProtectionBlockRequest}
        bind:newProtectionBlockForce={ctrl.newProtectionBlockForce}
        bind:newProtectionBlockDelete={ctrl.newProtectionBlockDelete}
        bind:newProtectionRestrictPush={ctrl.newProtectionRestrictPush}
        bind:newProtectionRestrictPushIds={ctrl.newProtectionRestrictPushIds}
        bind:newProtectionRestrictMergeIds={ctrl.newProtectionRestrictMergeIds}
        bind:newProtectionAllowBypass={ctrl.newProtectionAllowBypass}
        hasPerm={(perm) => ctrl.hasPerm(perm)}
        onConnect={() => void ctrl.onConnect()}
        onDisconnect={() => void ctrl.onDisconnect()}
        onBackup={() => void ctrl.onBackup()}
        onRestore={() => void ctrl.onRestore()}
        onTogglePublic={() => void ctrl.onTogglePublic()}
        openDeleteConfirm={() => ctrl.openDeleteConfirm()}
        onAddCollaborator={() => void ctrl.onAddCollaborator()}
        onSaveCollabPerms={() => void ctrl.onSaveCollabPerms()}
        onRemoveCollab={(userId) => void ctrl.onRemoveCollab(userId)}
        togglePerm={(list, perm) => ctrl.togglePerm(list, perm)}
        onCreateProtectionRule={() => void ctrl.onCreateProtectionRule()}
        onUpdateProtectionRule={(rule, patch) => void ctrl.onUpdateProtectionRule(rule, patch)}
        onDeleteProtectionRule={(rule) => void ctrl.onDeleteProtectionRule(rule)}
        />
      {/if}
    {/if}
  </div>

  {#if ctrl.viewing}
    <div
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      role="presentation"
      onclick={(e) => { if (e.target === e.currentTarget) ctrl.viewing = null; }}
      onkeydown={(e) => { if (e.key === "Escape") ctrl.viewing = null; }}
    >
      <div class="w-full max-w-3xl bg-card p-5 pixel-border flex flex-col gap-3 max-h-[85vh]">
        <div class="flex items-center gap-2">
          <FileText class="size-4" />
          <span class="font-mono text-sm font-bold truncate flex-1">{ctrl.viewing.path}</span>
          <span class="text-xs text-muted-foreground">{(ctrl.viewing.size / 1024).toFixed(1)} KB</span>
          <button class="pixel-border-sm px-2 py-1" onclick={() => (ctrl.viewing = null)}><X class="size-4" /></button>
        </div>
        {#if ctrl.blobError}
          <p class="text-sm text-destructive">{ctrl.blobError}</p>
        {:else if ctrl.viewing.encoding === "base64"}
          <p class="text-sm text-muted-foreground">
            Binary file: preview is not available (max {MAX_FILE_BROWSER_BYTES / 1024 / 1024} MB text preview).
            Use the ZIP/TAR download to fetch it.
          </p>
        {:else}
          <pre class="bg-background pixel-border-sm p-4 text-xs overflow-auto flex-1">{ctrl.viewing.content}</pre>
        {/if}
      </div>
    </div>
  {/if}

  {#if ctrl.showDeleteConfirm}
    <div
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      role="presentation"
      onclick={(e) => { if (!ctrl.deleting && e.target === e.currentTarget) ctrl.showDeleteConfirm = false; }}
      onkeydown={(e) => { if (e.key === "Escape" && !ctrl.deleting) ctrl.showDeleteConfirm = false; }}
    >
      <div class="w-full max-w-sm bg-card p-5 pixel-border">
        {#if ctrl.deleting}
          <h2 class="text-lg font-bold mb-4">Deleting project...</h2>
          <p class="text-sm text-muted-foreground mb-2">{ctrl.deleteStep}</p>
          <div class="h-2 bg-muted overflow-hidden">
            <div class="h-full bg-primary animate-pulse w-full"></div>
          </div>
        {:else}
          <h2 class="text-lg font-bold mb-2 text-destructive">Delete project</h2>
          <p class="text-sm text-muted-foreground mb-4">
            This permanently deletes <strong class="text-foreground">{ctrl.project.name}</strong> and all of its data:
            database record, local Git repository, and storage objects (LFS + backup). This cannot be undone.
          </p>
          <p class="text-sm mb-2">Type <strong class="text-foreground">{ctrl.project.name}</strong> to confirm:</p>
          <input
            class="pixel-border-sm bg-background px-3 py-2 text-sm w-full mb-4"
            bind:value={ctrl.deleteConfirmName}
            placeholder={ctrl.project.name}
            disabled={ctrl.deleting}
          />
          {#if ctrl.error}<p class="text-sm text-destructive mb-2">{ctrl.error}</p>{/if}
          <div class="flex gap-2 justify-end">
            <button class="pixel-border-sm px-4 py-2 text-sm" onclick={() => (ctrl.showDeleteConfirm = false)}>Cancel</button>
            <button class="pixel-border-sm px-4 py-2 text-sm bg-destructive text-destructive-foreground" disabled={!ctrl.canConfirmDelete} onclick={() => void ctrl.onDelete()}>
              Delete
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/if}
