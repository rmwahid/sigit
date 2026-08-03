<script lang="ts">
  import {
    listConnections,
    createConnection,
    deleteConnection,
    testConnection,
    listProjects,
    createProject,
    deleteProject,
    pushProject,
    getProjectHistory,
    getProjectDiff,
    getBootstrap,
    getMe,
    login,
    logout,
    type Connection,
    type Project,
    type CurrentUser,
  } from "$lib/api";
  import DiffViewer from "./DiffViewer.svelte";

  let authStatus = $state<"loading" | "setup" | "login" | "authed">("loading");
  let currentUser = $state<CurrentUser | null>(null);
  let loginEmail = $state("");
  let loginPassword = $state("");
  let setupEmail = $state("");
  let setupPassword = $state("");
  let setupConfirm = $state("");

  let connections = $state<Connection[]>([]);
  let projects = $state<Project[]>([]);
  let selectedProject = $state<Project | null>(null);
  let history = $state<{ hash: string; date: string; message: string; author: string }[]>([]);
  let diff = $state<{ diff: string; files: { path: string; status: string }[] } | null>(null);
  let error = $state("");
  let message = $state("");

  let connForm = $state({
    name: "",
    endpoint: "https://fsn1.your-objectstorage.com",
    region: "eu-central",
    accessKeyId: "",
    secretAccessKey: "",
    bucket: "",
    forcePathStyle: true,
    useEncryption: false,
  });

  let projectForm = $state({
    name: "",
    description: "",
    repoPath: "",
    storageConnectionId: "",
    lfsSizeThreshold: 10 * 1024 * 1024,
    lfsPatterns: "*.png,*.jpg,*.jpeg,*.gif,*.mp4,*.mov,*.zip,*.tar.gz,*.psd,*.ai,*.exe,*.bin,*.pdf",
    useEncryption: false,
  });

  let pushMessage = $state("");
  let pushPassphrase = $state("");
  let selectedFiles = $state<FileList | null>(null);

  async function load() {
    try {
      const [c, p] = await Promise.all([listConnections(), listProjects()]);
      connections = c.data;
      projects = p.data;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function initAuth() {
    authStatus = "loading";
    try {
      const boot = await getBootstrap();
      if (boot.data.needsSetup) {
        authStatus = "setup";
        return;
      }
      const me = await getMe();
      currentUser = me.data;
      authStatus = "authed";
      await load();
    } catch {
      authStatus = "login";
    }
  }

  async function onSetup(e: Event) {
    e.preventDefault();
    if (setupPassword !== setupConfirm) {
      error = "Passwords do not match";
      return;
    }
    try {
      // Create admin via API is not exposed; admin must be created via CLI (bun run db:create-admin).
      // After CLI setup, refresh auth state.
      error = "Admin setup must be done on the server via: bun run db:create-admin";
      await initAuth();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onLogin(e: Event) {
    e.preventDefault();
    try {
      const res = await login(loginEmail, loginPassword);
      currentUser = res.data;
      authStatus = "authed";
      loginEmail = "";
      loginPassword = "";
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onLogout() {
    try {
      await logout();
      currentUser = null;
      authStatus = "login";
      connections = [];
      projects = [];
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  initAuth();

  async function onCreateConnection(e: Event) {
    e.preventDefault();
    try {
      await createConnection(connForm);
      message = "Connection created";
      connForm = { name: "", endpoint: "https://fsn1.your-objectstorage.com", region: "eu-central", accessKeyId: "", secretAccessKey: "", bucket: "", forcePathStyle: true, useEncryption: false };
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function onCreateProject(e: Event) {
    e.preventDefault();
    try {
      await createProject(projectForm);
      message = "Project created";
      projectForm = { name: "", description: "", repoPath: "", storageConnectionId: "", lfsSizeThreshold: 10 * 1024 * 1024, lfsPatterns: "*.png,*.jpg,*.jpeg,*.gif,*.mp4,*.mov,*.zip,*.tar.gz,*.psd,*.ai,*.exe,*.bin,*.pdf", useEncryption: false };
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function onPush(e: Event) {
    e.preventDefault();
    if (!selectedProject || !selectedFiles || selectedFiles.length === 0) return;
    try {
      const result = await pushProject(selectedProject.id, selectedFiles, pushMessage, pushPassphrase || undefined);
      message = `Pushed ${result.data.files.length} files, commit ${result.data.commitHash.slice(0, 7)}`;
      await loadHistory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadHistory() {
    if (!selectedProject) return;
    try {
      const res = await getProjectHistory(selectedProject.id);
      history = res.data.commits;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function showDiff(hash: string) {
    if (!selectedProject) return;
    try {
      const res = await getProjectDiff(selectedProject.id, hash);
      diff = res.data;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

</script>

<svelte:head>
  <title>SiGit</title>
</svelte:head>

<main>
  <h1>SiGit</h1>
  {#if error}<p class="error">{error}</p>{/if}
  {#if message}<p class="message">{message}</p>{/if}

  {#if authStatus === "loading"}
    <p>Loading...</p>
  {:else if authStatus === "setup"}
    <section>
      <h2>Initial Setup</h2>
      <p>No admin user exists. Create the admin account on the server via CLI, then refresh:</p>
      <pre>cd repo/backend
bun run db:create-admin</pre>
      <button onclick={() => initAuth()}>I have created the admin</button>
    </section>
  {:else if authStatus === "login"}
    <section>
      <h2>Login</h2>
      <form onsubmit={onLogin}>
        <input type="email" bind:value={loginEmail} placeholder="Email" required />
        <input type="password" bind:value={loginPassword} placeholder="Password" required />
        <button type="submit">Login</button>
      </form>
    </section>
  {:else if authStatus === "authed" && currentUser}
    <p>Logged in as <strong>{currentUser.email}</strong> <button onclick={onLogout}>Logout</button></p>

  <section>
    <h2>Storage Connections</h2>
    <form onsubmit={onCreateConnection}>
      <input bind:value={connForm.name} placeholder="Name" required />
      <input bind:value={connForm.endpoint} placeholder="Endpoint" required />
      <input bind:value={connForm.region} placeholder="Region" required />
      <input bind:value={connForm.accessKeyId} placeholder="Access Key ID" required />
      <input type="password" bind:value={connForm.secretAccessKey} placeholder="Secret Access Key" required />
      <input bind:value={connForm.bucket} placeholder="Bucket" required />
      <label><input type="checkbox" bind:checked={connForm.forcePathStyle} /> Force path style</label>
      <label><input type="checkbox" bind:checked={connForm.useEncryption} /> Use encryption</label>
      <button type="submit">Create Connection</button>
    </form>
    <ul>
      {#each connections as conn}
        <li>
          {conn.name} ({conn.bucket})
          <button onclick={() => testConnection(conn.id).then(r => message = r.ok ? 'Connection OK' : `Failed: ${r.error}`)}>Test</button>
          <button onclick={() => deleteConnection(conn.id).then(load)}>Delete</button>
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h2>Projects</h2>
    <form onsubmit={onCreateProject}>
      <input bind:value={projectForm.name} placeholder="Project name" required />
      <input bind:value={projectForm.description} placeholder="Description" />
      <input bind:value={projectForm.repoPath} placeholder="Repo path (required)" required />
      <select bind:value={projectForm.storageConnectionId} required>
        <option value="">Select connection</option>
        {#each connections as conn}
          <option value={conn.id}>{conn.name}</option>
        {/each}
      </select>
      <input type="number" bind:value={projectForm.lfsSizeThreshold} placeholder="LFS size threshold (bytes)" />
      <input bind:value={projectForm.lfsPatterns} placeholder="LFS patterns" />
      <label><input type="checkbox" bind:checked={projectForm.useEncryption} /> Use encryption</label>
      <button type="submit">Create Project</button>
    </form>
    <ul>
      {#each projects as p}
        <li>
          <strong>{p.name}</strong>
          <button onclick={() => { selectedProject = p; loadHistory(); diff = null; }}>Select</button>
          <button onclick={() => deleteProject(p.id).then(load)}>Delete</button>
        </li>
      {/each}
    </ul>
  </section>

  {#if selectedProject}
    <section>
      <h2>Project: {selectedProject.name}</h2>

      <h3>Push Files</h3>
      <form onsubmit={onPush}>
        <input bind:value={pushMessage} placeholder="Commit message" required />
        <input type="file" multiple bind:files={selectedFiles} required />
        {#if selectedProject.useEncryption}
          <input type="password" bind:value={pushPassphrase} placeholder="Passphrase" required />
        {/if}
        <button type="submit">Push</button>
      </form>

      <h3>History</h3>
      {#if history.length === 0}
        <p>No commits yet.</p>
      {:else}
        <ul>
          {#each history as commit}
            <li>
              <code>{commit.hash.slice(0, 7)}</code> {commit.message} — {commit.date}
              <button onclick={() => showDiff(commit.hash)}>Diff</button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if diff}
        <h3>Diff</h3>
        <DiffViewer diff={diff.diff} />
      {/if}
    </section>
  {/if}
  {/if}
</main>

<style>
  main { max-width: 900px; margin: 0 auto; padding: 1rem; font-family: system-ui, sans-serif; }
  section { margin-bottom: 2rem; padding: 1rem; border: 1px solid #ddd; border-radius: 0.5rem; }
  form { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
  input, select, button { padding: 0.5rem; }
  .error { color: #b00; }
  .message { color: #080; }
  ul { list-style: none; padding: 0; }
  li { padding: 0.5rem 0; border-bottom: 1px solid #eee; }
  h3 { margin-top: 1.5rem; }
</style>
