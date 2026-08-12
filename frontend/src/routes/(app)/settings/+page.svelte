<script lang="ts">
  import { changePassword, revokeAllSessions } from "$lib/api";
  import { listTokens, createToken, revokeToken, type GitToken, type TokenScope } from "$lib/api/tokens";
  import Button from "$lib/components/ui/button/button.svelte";
  import Input from "$lib/components/ui/input/input.svelte";
  import Label from "$lib/components/ui/label/label.svelte";
  import Card from "$lib/components/ui/card/card.svelte";
  import CardHeader from "$lib/components/ui/card/card-header.svelte";
  import CardTitle from "$lib/components/ui/card/card-title.svelte";
  import CardContent from "$lib/components/ui/card/card-content.svelte";
  import CardFooter from "$lib/components/ui/card/card-footer.svelte";

  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  let revokePassword = $state("");
  let error = $state("");
  let message = $state("");

  let tokens = $state<GitToken[]>([]);
  let tokenName = $state("");
  let tokenScopes = $state<TokenScope[]>(["read"]);
  let tokenExpiry = $state(30);
  let newToken = $state("");
  let creatingToken = $state(false);
  let copied = $state(false);

  function toggleScope(scope: TokenScope) {
    if (tokenScopes.includes(scope)) {
      // jangan sampai kosong semua
      if (tokenScopes.length > 1) tokenScopes = tokenScopes.filter((s) => s !== scope);
    } else {
      tokenScopes = [...tokenScopes, scope];
    }
  }

  async function copyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // clipboard tidak tersedia — user bisa salin manual
    }
  }

  async function loadTokens() {
    try {
      const res = await listTokens();
      tokens = res.data;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onCreateToken() {
    if (!tokenName.trim()) return;
    creatingToken = true;
    error = "";
    try {
      const res = await createToken(tokenName.trim(), tokenScopes, tokenExpiry);
      newToken = res.data.token;
      tokenName = "";
      tokenScopes = ["read"];
      tokenExpiry = 30;
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
</script>

<div class="max-w-2xl mx-auto py-10 flex flex-col gap-10">
  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold tracking-widest">Settings</h1>
    <p class="text-sm text-muted-foreground mt-1">Manage git tokens, password, and sessions.</p>
  </div>

  {#if error}<div class="p-3 border border-destructive text-destructive text-sm">{error}</div>{/if}
  {#if message}<div class="p-3 border border-primary text-primary text-sm">{message}</div>{/if}

  <!-- Git Tokens -->
  <section class="flex flex-col gap-5">
    <div>
      <h2 class="text-lg font-bold">Git Tokens</h2>
      <p class="text-sm text-muted-foreground mt-1">
        Token dipakai sebagai password saat <code class="text-xs">git push</code>/<code class="text-xs">pull</code>
        (username bebas). Scope <code class="text-xs">read</code> hanya clone/pull — <code class="text-xs">write</code> juga push.
      </p>
    </div>

    {#if newToken}
      <div class="pixel-border border-primary bg-card p-4 flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold">Salin token ini sekarang — hanya tampil sekali.</span>
          <button class="pixel-border-sm px-3 py-1 text-xs" onclick={copyToken}>{copied ? "Copied!" : "Copy"}</button>
        </div>
        <code class="text-xs break-all bg-background px-3 py-2 pixel-border-sm">{newToken}</code>
      </div>
    {/if}

    <!-- Create form -->
    <div class="pixel-border bg-card p-5 flex flex-col gap-4">
      <div class="flex gap-3">
        <Input class="pixel-border-sm flex-1" bind:value={tokenName} placeholder="Token name (e.g. laptop-kerja)" disabled={creatingToken} />
        <Button class="pixel-border-sm shrink-0" onclick={onCreateToken} disabled={creatingToken || !tokenName.trim()}>
          {creatingToken ? "Creating..." : "Create Token"}
        </Button>
      </div>
      <div class="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div class="flex items-center gap-2">
          <span class="text-xs uppercase tracking-wider text-muted-foreground">Scopes</span>
          <button
            type="button"
            class="pixel-border-sm px-3 py-1 text-xs"
            class:bg-primary={tokenScopes.includes("read")}
            class:text-primary-foreground={tokenScopes.includes("read")}
            onclick={() => toggleScope("read")}
          >
            read
          </button>
          <button
            type="button"
            class="pixel-border-sm px-3 py-1 text-xs"
            class:bg-primary={tokenScopes.includes("write")}
            class:text-primary-foreground={tokenScopes.includes("write")}
            onclick={() => toggleScope("write")}
          >
            write
          </button>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs uppercase tracking-wider text-muted-foreground">Expires</span>
          <div class="flex items-center gap-1">
            <Input class="pixel-border-sm w-16 text-center" type="number" min={1} max={30} bind:value={tokenExpiry} disabled={creatingToken} />
            <span class="text-xs text-muted-foreground">days (max 30)</span>
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
                {#each t.scopes as s}
                  <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm">{s}</span>
                {/each}
              </div>
              <p class="text-xs text-muted-foreground mt-1">
                expires {new Date(t.expiresAt).toLocaleDateString()}
                <span class="mx-1">·</span>
                last used {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "never"}
              </p>
            </div>
            <button class="pixel-border-sm px-3 py-1 text-xs text-destructive shrink-0" onclick={() => onRevokeToken(t.id)}>Revoke</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground italic">No tokens yet — create one to push with git.</p>
    {/if}
  </section>

  <hr class="border-border" />

  <!-- Account -->
  <section class="grid grid-cols-1 md:grid-cols-2 gap-6">
    <Card class="pixel-border bg-card">
      <CardHeader>
        <CardTitle>Change Password</CardTitle>
      </CardHeader>
      <form onsubmit={onChangePassword}>
        <CardContent class="grid gap-3">
          <div class="grid gap-1">
            <Label for="cp">Current password</Label>
            <Input id="cp" class="pixel-border-sm" type="password" bind:value={currentPassword} required autocomplete="current-password" />
          </div>
          <div class="grid gap-1">
            <Label for="np">New password</Label>
            <Input id="np" class="pixel-border-sm" type="password" bind:value={newPassword} required minlength={8} autocomplete="new-password" />
          </div>
          <div class="grid gap-1">
            <Label for="cf">Confirm new password</Label>
            <Input id="cf" class="pixel-border-sm" type="password" bind:value={confirmPassword} required minlength={8} autocomplete="new-password" />
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
        <CardContent class="grid gap-3">
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
</div>
