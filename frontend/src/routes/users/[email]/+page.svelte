<script lang="ts">
  import { page } from "$app/stores";
  import type { ActivityDay } from "$lib/activity";
  import { getUserActivity, getUserProfile, type PublicUserProfile } from "$lib/api/explore";
  import { ADMIN_ROLE, roleName } from "$lib/constants/roles";
  import { Flame, GitBranch, Mail, Medal } from "lucide-svelte";
  import ActivityGraph from "$lib/components/activity/ActivityGraph.svelte";
  import PublicShell from "$lib/components/PublicShell.svelte";
  import Squiggle from "$lib/components/decor/Squiggle.svelte";

  let profile = $state<PublicUserProfile | null>(null);
  let activity = $state<ActivityDay[]>([]);
  let error = $state("");

  async function init() {
    const email = $page.params.email ?? "";
    if (!email) {
      error = "User not found.";
      return;
    }
    try {
      const [profileRes, activityRes] = await Promise.all([
        getUserProfile(email),
        getUserActivity(email).catch(() => null),
      ]);
      profile = profileRes.data;
      activity = activityRes?.data.days ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  init();
</script>

<svelte:head>
  <title>{$page.params.email ?? "User"} - SiGit</title>
</svelte:head>

<PublicShell>
  {#if error}
    <div class="pixel-border nb-dashed bg-card p-8 text-center text-muted-foreground">
      <p class="text-lg font-bold">User not found</p>
    </div>
  {:else if !profile}
    <p class="text-muted-foreground">Loading...</p>
  {:else}
    <div class="pixel-border bg-card p-6 mb-6 flex items-center gap-4">
      <div class="size-14 pixel-border-sm bg-secondary text-secondary-foreground nb-tilt flex items-center justify-center text-xl font-extrabold">
        {profile.email[0]?.toUpperCase()}
      </div>
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-extrabold tracking-tight flex items-center gap-2">
          <span class="nb-mark">{profile.email}</span>
        </h1>
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Mail class="size-3.5" />
          <span>{profile.email}</span>
          <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm {profile.role === ADMIN_ROLE ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}">
            {roleName(profile.role)}
          </span>
        </div>
      </div>
    </div>

    <h2 class="flex items-center gap-2 text-xl font-extrabold mb-2">
      <Flame class="size-5 text-primary" aria-hidden="true" />
      Activity
    </h2>
    <Squiggle class="h-2 w-32 mb-4 text-accent" />
    <div class="mb-6">
      <ActivityGraph days={activity} />
    </div>

    <h2 class="flex items-center gap-2 text-xl font-extrabold mb-2">
      <Medal class="size-5 text-primary" aria-hidden="true" />
      Public projects
    </h2>
    <Squiggle class="h-2 w-32 mb-4 text-accent" />
    {#if profile.projects.length === 0}
      <div class="pixel-border nb-dashed bg-card p-8 text-center text-muted-foreground">
        <p class="text-lg font-bold">No public projects</p>
        <p class="text-sm mt-1">Public projects owned by this user appear here.</p>
      </div>
    {:else}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {#each profile.projects as p}
          <a
            href={`/projects/${p.id}`}
            class="pixel-border bg-card p-4 flex flex-col gap-2 transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--border)]"
          >
            <div class="flex items-center gap-2">
              <GitBranch class="size-4" />
              <span class="font-bold">{p.name}</span>
              <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm bg-accent text-accent-foreground">public</span>
            </div>
            <p class="text-sm text-muted-foreground truncate">{p.description ?? "No description"}</p>
          </a>
        {/each}
      </div>
    {/if}
  {/if}
</PublicShell>
