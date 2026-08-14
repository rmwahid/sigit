<script lang="ts">
  import { changePassword, revokeAllSessions } from "$lib/api";
  import {
    listTokens,
    createToken,
    revokeToken,
    type GitToken,
    type TokenProjectScope,
  } from "$lib/api/tokens";
  import { projectsStore } from "$lib/stores/projects.svelte";
  import { DEFAULT_TOKEN_SCOPE, scopeLabel, TOKEN_SCOPE_OPTIONS, type TokenScope } from "$lib/constants/scopes";
  import {
    COPY_FEEDBACK_MS,
    MIN_PASSWORD_LENGTH,
    TOKEN_DEFAULT_EXPIRY_DAYS,
    TOKEN_MAX_EXPIRY_DAYS,
    TOKEN_MIN_EXPIRY_DAYS,
  } from "$lib/constants/validation";
  import { COPY, PLACEHOLDERS } from "$lib/constants/copy";
  import { formatDate } from "$lib/utils";
  import { ADMIN_ROLE, roleName } from "$lib/constants/roles";
  import { getMe, listUsers, resetUserPassword, deleteUser, type ManagedUser } from "$lib/api";
  import { createInvitation, listInvitations, revokeInvitation, type Invitation } from "$lib/api/invitations";
  import { getEmailSettings, updateEmailSettings, testEmail } from "$lib/api/email-settings";
  import Button from "$lib/components/ui/button/button.svelte";
  import Input from "$lib/components/ui/input/input.svelte";
  import Label from "$lib/components/ui/label/label.svelte";
  import Card from "$lib/components/ui/card/card.svelte";
  import CardHeader from "$lib/components/ui/card/card-header.svelte";
  import CardTitle from "$lib/components/ui/card/card-title.svelte";
  import CardContent from "$lib/components/ui/card/card-content.svelte";
  import CardFooter from "$lib/components/ui/card/card-footer.svelte";
  import Squiggle from "$lib/components/decor/Squiggle.svelte";
  import { KeyRound, Mail, UserRound, Users as UsersIcon } from "lucide-svelte";

  let tab = $state<"account" | "tokens" | "users" | "email">("account");

  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  let revokePassword = $state("");
  let error = $state("");
  let message = $state("");

  let tokens = $state<GitToken[]>([]);
  let tokenName = $state("");
  // projectId -> selected scope for the token being created
  let tokenProjects = $state<Record<string, TokenScope>>({});
  let tokenExpiry = $state(TOKEN_DEFAULT_EXPIRY_DAYS);
  let newToken = $state("");
  let creatingToken = $state(false);
  let copied = $state(false);

  const projects = $derived(projectsStore.list);
  const canCreate = $derived(tokenName.trim().length > 0 && Object.keys(tokenProjects).length > 0);

  // Admin-only sections (Collaborators + Email)
  let isAdmin = $state(false);
  let users = $state<ManagedUser[]>([]);
  let invites = $state<Invitation[]>([]);
  let inviteEmail = $state("");
  let inviteResult = $state<{ inviteLink: string; emailSent: boolean } | null>(null);
  let resetTarget = $state<ManagedUser | null>(null);
  let resetPassword = $state("");
  let emailSettings = $state<{ apiKeyMasked: string | null; hasApiKey: boolean; fromEmail: string | null } | null>(null);
  let emailApiKey = $state("");
  let emailFrom = $state("");
  let testingEmail = $state(false);

  async function loadAdminData() {
    try {
      const me = await getMe();
      isAdmin = me.data.role === ADMIN_ROLE;
      if (!isAdmin) return;
      const [u, i, e] = await Promise.all([listUsers(), listInvitations(), getEmailSettings()]);
      // Collaborators tab: the site admin is not a collaborator, so they are
      // managed from the Account tab, not listed here.
      users = u.data.filter((x) => x.role !== ADMIN_ROLE);
      invites = i.data;
      emailSettings = e.data;
      emailFrom = e.data.fromEmail ?? "";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onInvite() {
    if (!inviteEmail.trim()) return;
    error = "";
    try {
      const res = await createInvitation(inviteEmail.trim());
      inviteResult = { inviteLink: res.data.inviteLink, emailSent: res.data.emailSent };
      inviteEmail = "";
      const list = await listInvitations();
      invites = list.data;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onRevokeInvite(id: string) {
    error = "";
    try {
      await revokeInvitation(id);
      invites = (await listInvitations()).data;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onResetPassword() {
    if (!resetTarget || resetPassword.length < MIN_PASSWORD_LENGTH) return;
    error = "";
    try {
      await resetUserPassword(resetTarget.id, resetPassword);
      message = `Password reset for ${resetTarget.email}`;
      resetTarget = null;
      resetPassword = "";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onDeleteUser(id: string, email: string) {
    if (!confirm(`Delete user ${email}? Their sessions, tokens and project access are removed.`)) return;
    error = "";
    try {
      await deleteUser(id);
      users = (await listUsers()).data;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onSaveEmail() {
    error = "";
    try {
      await updateEmailSettings({ apiKey: emailApiKey || undefined, fromEmail: emailFrom || undefined });
      emailApiKey = "";
      const e = await getEmailSettings();
      emailSettings = e.data;
      emailFrom = e.data.fromEmail ?? "";
      message = "Email settings saved";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onTestEmail() {
    testingEmail = true;
    error = "";
    try {
      const res = await testEmail();
      message = res.message;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      testingEmail = false;
    }
  }

  function projectName(projectId: string): string {
    return projects.find((p) => p.id === projectId)?.name ?? projectId.slice(0, 8);
  }

  function toggleProject(projectId: string, checked: boolean) {
    if (checked) {
      tokenProjects = { ...tokenProjects, [projectId]: DEFAULT_TOKEN_SCOPE };
    } else {
      const next = { ...tokenProjects };
      delete next[projectId];
      tokenProjects = next;
    }
  }

  function setProjectScope(projectId: string, scope: TokenScope) {
    tokenProjects = { ...tokenProjects, [projectId]: scope };
  }

  async function copyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      copied = true;
      setTimeout(() => (copied = false), COPY_FEEDBACK_MS);
    } catch {
      // clipboard unavailable, user can copy manually
    }
  }

  async function loadTokens() {
    try {
      if (!projectsStore.isLoaded) await projectsStore.refresh();
      const res = await listTokens();
      tokens = res.data;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onCreateToken() {
    if (!canCreate) return;
    creatingToken = true;
    error = "";
    try {
      const tokenProjectsList: TokenProjectScope[] = Object.entries(tokenProjects).map(
        ([projectId, scope]) => ({ projectId, scope })
      );
      const res = await createToken(tokenName.trim(), tokenProjectsList, tokenExpiry);
      newToken = res.data.token;
      tokenName = "";
      tokenProjects = {};
      tokenExpiry = TOKEN_DEFAULT_EXPIRY_DAYS;
      copied = false;
      await loadTokens();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      creatingToken = false;
    }
  }

  async function onRevokeToken(id: string) {
    error = "";
    try {
      await revokeToken(id);
      if (newToken) newToken = "";
      await loadTokens();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onChangePassword(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    message = "";
    if (newPassword !== confirmPassword) {
      error = "New passwords do not match";
      return;
    }
    try {
      await changePassword(currentPassword, newPassword);
      message = "Password changed. Other sessions revoked.";
      currentPassword = "";
      newPassword = "";
      confirmPassword = "";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onRevokeAll(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    message = "";
    try {
      await revokeAllSessions(revokePassword);
      message = "All other sessions revoked.";
      revokePassword = "";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  loadTokens();
  loadAdminData();
</script>

<div class="max-w-3xl mx-auto py-8 flex flex-col gap-6">
  <!-- Header -->
  <div>
    <h1 class="text-3xl font-extrabold mb-2"><span class="nb-mark">Settings</span></h1>
    <Squiggle class="h-2.5 w-32 text-accent" />
  </div>

  {#if error}<div class="p-3 border border-destructive text-destructive text-sm">{error}</div>{/if}
  {#if message}<div class="p-3 border border-primary text-primary text-sm">{message}</div>{/if}

  <!-- Tab bar -->
  <div class="flex gap-1 border-b-2 border-border">
    <button
      class="px-4 py-1.5 text-sm font-bold flex items-center gap-1.5 border-2 border-b-0 border-border rounded-t-sm {tab === "account" ? "bg-primary text-primary-foreground -mb-0.5" : "bg-card hover:bg-muted"}"
      onclick={() => (tab = "account")}
    >
      <UserRound class="size-3.5" /> Account
    </button>
    <button
      class="px-4 py-1.5 text-sm font-bold flex items-center gap-1.5 border-2 border-b-0 border-border rounded-t-sm {tab === "tokens" ? "bg-primary text-primary-foreground -mb-0.5" : "bg-card hover:bg-muted"}"
      onclick={() => (tab = "tokens")}
    >
      <KeyRound class="size-3.5" /> Tokens
    </button>
    {#if isAdmin}
      <button
        class="px-4 py-1.5 text-sm font-bold flex items-center gap-1.5 border-2 border-b-0 border-border rounded-t-sm {tab === "users" ? "bg-primary text-primary-foreground -mb-0.5" : "bg-card hover:bg-muted"}"
        onclick={() => (tab = "users")}
      >
        <UsersIcon class="size-3.5" /> Collaborators
      </button>
      <button
        class="px-4 py-1.5 text-sm font-bold flex items-center gap-1.5 border-2 border-b-0 border-border rounded-t-sm {tab === "email" ? "bg-primary text-primary-foreground -mb-0.5" : "bg-card hover:bg-muted"}"
        onclick={() => (tab = "email")}
      >
        <Mail class="size-3.5" /> Email
      </button>
    {/if}
  </div>

  {#if tab === "account"}
  <!-- Account -->
  <section class="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
    <Card class="pixel-border bg-card">
      <CardHeader>
        <CardTitle>Change Password</CardTitle>
      </CardHeader>
      <form onsubmit={onChangePassword}>
        <CardContent class="grid gap-3 pb-4">
          <div class="grid gap-1">
            <Label for="cp">Current password</Label>
            <Input id="cp" class="pixel-border-sm" type="password" bind:value={currentPassword} required autocomplete="current-password" />
          </div>
          <div class="grid gap-1">
            <Label for="np">New password</Label>
            <Input id="np" class="pixel-border-sm" type="password" bind:value={newPassword} required minlength={MIN_PASSWORD_LENGTH} autocomplete="new-password" />
          </div>
          <div class="grid gap-1">
            <Label for="cf">Confirm new password</Label>
            <Input id="cf" class="pixel-border-sm" type="password" bind:value={confirmPassword} required minlength={MIN_PASSWORD_LENGTH} autocomplete="new-password" />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" class="w-full pixel-border-sm">Change Password</Button>
        </CardFooter>
      </form>
    </Card>

    <Card class="pixel-border bg-card">
      <CardHeader>
        <CardTitle>Revoke All Sessions</CardTitle>
      </CardHeader>
      <form onsubmit={onRevokeAll}>
        <CardContent class="grid gap-3 pb-4">
          <p class="text-sm text-muted-foreground">Log out all other devices. Enter your password to confirm.</p>
          <div class="grid gap-1">
            <Label for="rp">Password</Label>
            <Input id="rp" class="pixel-border-sm" type="password" bind:value={revokePassword} required />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" class="w-full pixel-border-sm">Revoke All Sessions</Button>
        </CardFooter>
      </form>
    </Card>
  </section>
  {/if}

  {#if tab === "tokens"}
  <!-- Git Tokens -->
  <section class="flex flex-col gap-5">
    <div>
      <h2 class="text-lg font-bold">Git Tokens</h2>
      <p class="text-sm text-muted-foreground mt-1">
        The token is used as the password for <code class="text-xs">git push</code>/<code class="text-xs">pull</code>
        (username is free-form). Access is PER PROJECT: scope <code class="text-xs">read</code> (clone/pull) or
        <code class="text-xs">read+write</code> (push + LFS upload).
      </p>
    </div>

    {#if newToken}
      <div class="pixel-border border-primary bg-card p-4 flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold">Copy this token now - it is only shown once.</span>
          <button class="pixel-border-sm px-3 py-1 text-xs" onclick={copyToken}>{copied ? "Copied!" : "Copy"}</button>
        </div>
        <code class="text-xs break-all bg-background px-3 py-2 pixel-border-sm">{newToken}</code>
      </div>
    {/if}

    <!-- Create form -->
    <div class="pixel-border bg-card p-5 flex flex-col gap-4">
      <div class="flex gap-3">
        <Input class="pixel-border-sm flex-1" bind:value={tokenName} placeholder="Token name (e.g. laptop-kerja)" disabled={creatingToken} />
        <Button class="pixel-border-sm shrink-0" onclick={onCreateToken} disabled={creatingToken || !canCreate}>
          {creatingToken ? "Creating..." : "Create Token"}
        </Button>
      </div>
      <div class="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div class="flex-1 min-w-72">
          <span class="text-xs uppercase tracking-wider text-muted-foreground">Project access</span>
          <div class="mt-2 flex flex-col gap-2">
            {#if projects.length === 0}
              <p class="text-xs text-muted-foreground italic">No projects yet.</p>
            {:else}
              {#each projects as p}
                <div class="flex items-center gap-3">
                  <input
                    type="checkbox"
                    class="accent-primary"
                    checked={p.id in tokenProjects}
                    onchange={(e) => toggleProject(p.id, e.currentTarget.checked)}
                    disabled={creatingToken}
                  />
                  <span class="text-sm flex-1 truncate">{p.name}</span>
                  {#if p.id in tokenProjects}
                    <select
                      class="pixel-border-sm bg-background px-2 py-1 text-xs"
                      value={tokenProjects[p.id]}
                      onchange={(e) => setProjectScope(p.id, e.currentTarget.value as TokenScope)}
                      disabled={creatingToken}
                    >
                      {#each TOKEN_SCOPE_OPTIONS as opt}
                        <option value={opt.value}>{opt.label}</option>
                      {/each}
                    </select>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs uppercase tracking-wider text-muted-foreground">Expires</span>
          <div class="flex items-center gap-1">
            <Input class="pixel-border-sm w-16 text-center" type="number" min={TOKEN_MIN_EXPIRY_DAYS} max={TOKEN_MAX_EXPIRY_DAYS} bind:value={tokenExpiry} disabled={creatingToken} />
            <span class="text-xs text-muted-foreground">{COPY.DAYS_MAX_LABEL}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Token list -->
    {#if tokens.length > 0}
      <ul class="flex flex-col gap-2">
        {#each tokens as t}
          <li class="pixel-border-sm bg-card px-4 py-3 flex items-center gap-3">
            <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium truncate">{t.name}</span>
              {#if t.projects.length === 0}
                <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-destructive text-destructive rounded-sm">no access</span>
              {/if}
              {#each t.projects as pr}
                <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm">
                  {projectName(pr.projectId)}: {scopeLabel(pr.scope)}
                </span>
              {/each}
            </div>
              <p class="text-xs text-muted-foreground mt-1">
                expires {formatDate(t.expiresAt)}
                <span class="mx-1">·</span>
                last used {t.lastUsedAt ? formatDate(t.lastUsedAt) : "never"}
              </p>
            </div>
            <button class="pixel-border-sm px-3 py-1 text-xs text-destructive shrink-0" onclick={() => onRevokeToken(t.id)}>Revoke</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground italic">No tokens yet - create one to push with git.</p>
    {/if}
  </section>
  {/if}

  {#if isAdmin}
    {#if tab === "users"}
    <!-- Users -->
    <section class="flex flex-col gap-5">
      <div>
        <h2 class="text-lg font-bold">Collaborators</h2>
        <p class="text-sm text-muted-foreground mt-1">
          Invite people by email. Invitees set their own password via the invite link.
        </p>
      </div>

      {#if inviteResult}
        {@const inviteLink = inviteResult.inviteLink}
        <div class="pixel-border border-primary bg-card p-4 flex flex-col gap-2">
          {#if inviteResult.emailSent}
            <span class="text-sm font-semibold">Invitation email sent.</span>
          {:else}
            <span class="text-sm font-semibold">{COPY.EMAIL_NOT_CONFIGURED}</span>
            <code class="text-xs break-all bg-background px-3 py-2 pixel-border-sm">{inviteLink}</code>
            <button
              class="pixel-border-sm px-3 py-1 text-xs self-start"
              onclick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteLink);
                  message = COPY.INVITE_LINK_COPIED;
                } catch {
                  // clipboard unavailable, user can copy manually
                }
              }}
            >
              Copy
            </button>
          {/if}
        </div>
      {/if}

      <div class="pixel-border bg-card p-5 flex flex-col gap-4">
        <div class="flex gap-3 items-end">
          <div class="flex-1">
            <Label for="invite-email">Email</Label>
            <Input id="invite-email" class="pixel-border-sm w-full" bind:value={inviteEmail} placeholder={PLACEHOLDERS.INVITE_EMAIL} />
          </div>
          <Button class="pixel-border-sm shrink-0" onclick={onInvite} disabled={!inviteEmail.trim()}>Invite</Button>
        </div>
        <p class="text-xs text-muted-foreground">Invitees always join as collaborators. The site admin is a single fixed account.</p>
      </div>

      <ul class="flex flex-col gap-2">
        {#each users as u}
          <li class="pixel-border-sm bg-card px-4 py-3 flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <span class="font-medium truncate">{u.email}</span>
              <p class="text-xs text-muted-foreground mt-1">joined {formatDate(u.createdAt)}</p>
            </div>
            <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm">{roleName(u.role)}</span>
            <button class="pixel-border-sm px-3 py-1 text-xs" onclick={() => (resetTarget = u)}>Reset password</button>
            <button class="pixel-border-sm px-3 py-1 text-xs text-destructive shrink-0" onclick={() => onDeleteUser(u.id, u.email)}>
              Delete
            </button>
          </li>
        {/each}
      </ul>

      {#if resetTarget}
        <div class="pixel-border bg-card p-4 flex flex-col gap-2">
          <span class="text-sm font-semibold">Reset password for {resetTarget.email}</span>
          <div class="flex gap-2 items-end">
            <Input class="pixel-border-sm flex-1" type="password" bind:value={resetPassword} placeholder={PLACEHOLDERS.TEMP_PASSWORD} />
            <button class="pixel-border-sm px-3 py-1 text-xs" onclick={onResetPassword} disabled={resetPassword.length < MIN_PASSWORD_LENGTH}>Set</button>
            <button class="pixel-border-sm px-3 py-1 text-xs" onclick={() => (resetTarget = null)}>Cancel</button>
          </div>
        </div>
      {/if}

      {#if invites.length > 0}
        <div>
          <span class="text-xs uppercase tracking-wider text-muted-foreground">Pending invitations</span>
          <ul class="mt-2 flex flex-col gap-2">
            {#each invites as inv}
              <li class="pixel-border-sm bg-card px-4 py-2 flex items-center gap-3">
                <span class="flex-1 truncate text-sm">{inv.email}</span>
                <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm">{roleName(inv.role)}</span>
                <button class="pixel-border-sm px-2 py-1 text-xs text-destructive" onclick={() => onRevokeInvite(inv.id)}>Revoke</button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </section>
    {/if}

    {#if tab === "email"}
    <!-- Email -->
    <section class="flex flex-col gap-4">
      <div>
        <h2 class="text-lg font-bold">Email</h2>
        <p class="text-sm text-muted-foreground mt-1">
          Resend API key for invitation emails{emailSettings?.hasApiKey ? ` (current key: ${emailSettings.apiKeyMasked})` : " (not configured yet)"}.
        </p>
      </div>
      <div class="pixel-border bg-card p-5 flex flex-col gap-4">
        <div class="grid gap-1">
          <Label for="email-key">Resend API key</Label>
          <Input id="email-key" class="pixel-border-sm w-full" type="password" bind:value={emailApiKey} placeholder={PLACEHOLDERS.RESEND_API_KEY} autocomplete="off" />
        </div>
        <div class="grid gap-1">
          <Label for="email-from">From email</Label>
          <Input id="email-from" class="pixel-border-sm w-full" bind:value={emailFrom} placeholder={PLACEHOLDERS.EMAIL_FROM} />
        </div>
        <div class="flex gap-2">
          <Button class="pixel-border-sm" onclick={onSaveEmail}>Save</Button>
          <Button class="pixel-border-sm" onclick={onTestEmail} disabled={testingEmail || !emailSettings?.hasApiKey}>
            {testingEmail ? "Sending..." : "Send test email"}
          </Button>
        </div>
      </div>
    </section>
    {/if}
  {/if}
</div>
