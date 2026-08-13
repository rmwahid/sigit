<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { acceptInvite, getInvite } from "$lib/api";
  import { DEFAULT_ROLE, roleName, type UserRole } from "$lib/constants/roles";
  import { MIN_PASSWORD_LENGTH } from "$lib/constants/validation";
  import { COPY } from "$lib/constants/copy";
  import Button from "$lib/components/ui/button/button.svelte";
  import Input from "$lib/components/ui/input/input.svelte";
  import Label from "$lib/components/ui/label/label.svelte";
  import Card from "$lib/components/ui/card/card.svelte";
  import CardHeader from "$lib/components/ui/card/card-header.svelte";
  import CardTitle from "$lib/components/ui/card/card-title.svelte";
  import CardContent from "$lib/components/ui/card/card-content.svelte";

  let status = $state<"loading" | "invalid" | "ready">("loading");
  let email = $state("");
  let role = $state<UserRole>(DEFAULT_ROLE);
  let password = $state("");
  let confirm = $state("");
  let error = $state("");
  let submitting = $state(false);

  async function init() {
    const token = $page.url.searchParams.get("token") ?? "";
    if (!token) {
      status = "invalid";
      return;
    }
    try {
      const res = await getInvite(token);
      email = res.data.email;
      role = res.data.role;
      status = "ready";
    } catch {
      status = "invalid";
    }
  }

  init();

  async function onSubmit() {
    if (password.length < MIN_PASSWORD_LENGTH) {
      error = COPY.PASSWORD_MIN_ERROR;
      return;
    }
    if (password !== confirm) {
      error = "Passwords do not match.";
      return;
    }
    submitting = true;
    error = "";
    try {
      const token = $page.url.searchParams.get("token") ?? "";
      await acceptInvite(token, password);
      await goto("/");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-background p-4">
  <Card class="w-full max-w-sm pixel-border bg-card">
    {#if status === "loading"}
      <CardContent class="flex justify-center py-10">
        <p class="text-muted-foreground">Loading...</p>
      </CardContent>
    {:else if status === "invalid"}
      <CardHeader>
        <CardTitle>Invalid invitation</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-sm text-muted-foreground">
          This invitation link is invalid or has expired. Ask an administrator to send a new one.
        </p>
      </CardContent>
    {:else}
      <CardHeader>
        <CardTitle>Set up your account</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-sm text-muted-foreground mb-4">
          You are invited as <strong>{roleName(role)}</strong>. Set a password for <strong>{email}</strong> to continue.
        </p>
        {#if error}<p class="text-sm text-destructive mb-2">{error}</p>{/if}
        <form class="grid gap-3" onsubmit={(e) => { e.preventDefault(); onSubmit(); }}>
          <div class="grid gap-1">
            <Label for="p">Password</Label>
            <Input id="p" type="password" bind:value={password} required minlength={MIN_PASSWORD_LENGTH} autocomplete="new-password" />
          </div>
          <div class="grid gap-1">
            <Label for="cf">Confirm password</Label>
            <Input id="cf" type="password" bind:value={confirm} required minlength={MIN_PASSWORD_LENGTH} autocomplete="new-password" />
          </div>
          <Button type="submit" class="w-full pixel-border-sm" disabled={submitting}>
            {submitting ? "Creating account..." : "Create account and log in"}
          </Button>
        </form>
      </CardContent>
    {/if}
  </Card>
</div>
