<script lang="ts">
  import { getBootstrap, login } from "$lib/api";
  import { goto } from "$app/navigation";
  import Button from "$lib/components/ui/button/button.svelte";
  import Input from "$lib/components/ui/input/input.svelte";
  import Label from "$lib/components/ui/label/label.svelte";
  import Card from "$lib/components/ui/card/card.svelte";
  import CardHeader from "$lib/components/ui/card/card-header.svelte";
  import CardTitle from "$lib/components/ui/card/card-title.svelte";
  import CardDescription from "$lib/components/ui/card/card-description.svelte";
  import CardContent from "$lib/components/ui/card/card-content.svelte";
  import CardFooter from "$lib/components/ui/card/card-footer.svelte";
  import ThemeToggle from "$lib/ThemeToggle.svelte";
  import Starburst from "$lib/components/decor/Starburst.svelte";
  import Squiggle from "$lib/components/decor/Squiggle.svelte";
  import { Crown } from "lucide-svelte";

  let status = $state<"loading" | "setup" | "login">("loading");
  let email = $state("");
  let password = $state("");
  let error = $state("");
  let submitting = $state(false);

  async function init() {
    try {
      const boot = await getBootstrap();
      if (boot.data.needsSetup) {
        status = "setup";
        return;
      }
      status = "login";
    } catch {
      status = "login";
    }
  }

  async function onLogin(e: SubmitEvent) {
    e.preventDefault();
    submitting = true;
    error = "";
    try {
      await login(email, password);
      await goto("/");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  init();
</script>

<svelte:head>
  <title>Login - SiGit</title>
</svelte:head>

<div class="relative min-h-screen flex items-center justify-center bg-background p-4">
  <div class="absolute inset-0 nb-dots pointer-events-none" aria-hidden="true"></div>
  <div class="absolute -top-4 -left-4 size-24 bg-secondary pixel-border nb-tilt" aria-hidden="true"></div>
  <div class="absolute -bottom-4 -right-4 size-24 bg-accent pixel-border" aria-hidden="true"></div>
  <Starburst class="absolute bottom-16 left-16 size-10 text-primary" />
  <div class="absolute top-4 right-4">
    <ThemeToggle />
  </div>
  <Card class="w-full max-w-sm pixel-border bg-card">
    {#if status === "loading"}
      <CardContent class="flex justify-center py-10">
        <p class="text-muted-foreground">Loading...</p>
      </CardContent>
    {:else if status === "setup"}
      <CardHeader>
        <CardTitle>Initial Setup</CardTitle>
        <CardDescription>No admin user exists yet. Create the admin account on the server.</CardDescription>
      </CardHeader>
      <CardContent>
        <pre class="bg-muted p-3 text-xs overflow-x-auto mb-4">cd repo/backend
bun run db:create-admin</pre>
        <p class="text-sm text-muted-foreground">When done, click the button below.</p>
        {#if error}<p class="text-sm text-destructive mt-2">{error}</p>{/if}
      </CardContent>
      <CardFooter>
        <Button class="w-full pixel-border-sm" onclick={init}>I have created the admin</Button>
      </CardFooter>
    {:else}
      <CardHeader class="text-center">
        <Crown class="size-8 text-primary mx-auto mb-1 rotate-12" />
        <CardTitle class="text-4xl tracking-tight font-extrabold"><span class="nb-mark">SiGit</span></CardTitle>
        <CardDescription>Storage Integration for Git</CardDescription>
        <Squiggle class="h-2 w-24 mx-auto mt-2 text-accent" />
      </CardHeader>
      <form onsubmit={onLogin}>
        <CardContent class="grid gap-4 pb-4">
          <div class="grid gap-2">
            <Label for="email">Email</Label>
            <Input id="email" type="email" bind:value={email} placeholder="admin@sigit.dev" required autocomplete="email" class="pixel-border-sm" />
          </div>
          <div class="grid gap-2">
            <Label for="password">Password</Label>
            <Input id="password" type="password" bind:value={password} placeholder="••••••••" required autocomplete="current-password" class="pixel-border-sm" />
          </div>
          {#if error}<p class="text-sm text-destructive">{error}</p>{/if}
        </CardContent>
        <CardFooter>
          <Button type="submit" class="w-full pixel-border-sm" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </CardFooter>
      </form>
    {/if}
  </Card>
</div>
