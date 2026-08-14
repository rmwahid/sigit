<script lang="ts">
  import { onMount } from "svelte";
  import { getLogs, openLogStream, type LogEntry } from "$lib/api";

  let entries = $state<LogEntry[]>([]);
  let loadingOlder = $state(false);
  let stream: { close: () => void } | null = null;

  function renderLine(entry: LogEntry): string {
    const ts = entry.ts ? new Date(entry.ts).toLocaleTimeString() : "";
    const scope = entry.scope ?? entry.event ?? "-";
    return `${ts}  [${scope}]  ${entry.message ?? ""}`;
  }

  function levelClass(entry: LogEntry): string {
    const lv = entry.level ?? "";
    if (lv === "error") return "err";
    if (lv === "warn") return "warn";
    return "";
  }

  async function loadOlder() {
    if (loadingOlder) return;
    loadingOlder = true;
    try {
      const oldest = entries[0]?.ts;
      const res = await getLogs(200, oldest);
      const older = res.data;
      if (older.length > 0) {
        entries = [...older, ...entries];
      }
    } catch (e) {
      console.error("load older failed", e);
    } finally {
      loadingOlder = false;
    }
  }

  onMount(() => {
    getLogs(200).then((res) => {
      entries = res.data;
    });
    stream = openLogStream((entry) => {
      entries = [...entries, entry];
      if (entries.length > 500) entries = entries.slice(-500);
    });
    return () => {
      stream?.close();
    };
  });
</script>

<div class="logviewer">
  <div class="toolbar">
    <button class="pixel-border-sm px-3 py-1 text-sm" onclick={loadOlder} disabled={loadingOlder}>
      {loadingOlder ? "Loading..." : "Load older"}
    </button>
    <span class="count">{entries.length} entries</span>
  </div>
  <pre class="loglist" tabindex="-1" role="log" aria-label="Live log entries">
{#each entries as entry (entry.ts + entry.scope + entry.message)}
<span class:err={levelClass(entry) === "err"} class:warn={levelClass(entry) === "warn"}>{renderLine(entry)}</span>
{/each}
  </pre>
</div>

<style>
  .logviewer { display: flex; flex-direction: column; gap: 0.75rem; }
  .toolbar { display: flex; align-items: center; gap: 0.75rem; }
  .count { color: var(--muted-foreground); font-size: 0.85rem; }
  .loglist {
    max-height: 450px;
    overflow-y: auto;
    background: var(--card);
    color: var(--foreground);
    border: 2px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 4px 4px 0 0 var(--border);
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    line-height: 1.5;
    padding: 0.75rem;
    white-space: pre-wrap;
  }
  .err { color: var(--destructive); }
  .warn { color: #d29922; }
</style>
