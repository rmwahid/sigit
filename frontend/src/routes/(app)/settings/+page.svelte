<script lang="ts">
  import { changePassword, revokeAllSessions } from "$lib/api";
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
</script>

<div class="max-w-md flex flex-col gap-6">
  {#if error}<div class="p-2 border border-destructive text-destructive text-sm">{error}</div>{/if}
  {#if message}<div class="p-2 border border-primary text-primary text-sm">{message}</div>{/if}

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
</div>
