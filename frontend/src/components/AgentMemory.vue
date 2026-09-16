<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { fetchMemory, type MemorySummary, type MemorySession, type AgentSummary } from '../api'

const props = defineProps<{
  agent?: AgentSummary | null
  refreshKey?: number
}>()

const emit = defineEmits<{
  recall: [session: MemorySession]
}>()

const memory = ref<MemorySummary | null>(null)
const loading = ref(false)
const error = ref('')
const selectedId = ref<string | null>(null)

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return d.toLocaleDateString()
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function shortTx(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`
}

const explorerBase = computed(() => {
  const chainId = props.agent?.walletChainId ?? 421614
  return chainId === 42161 ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io'
})

async function load() {
  const name = props.agent?.name
  if (!name) {
    memory.value = null
    error.value = ''
    selectedId.value = null
    return
  }
  loading.value = true
  error.value = ''
  try {
    memory.value = await fetchMemory(name)
    // reset selection if memory changed and selected id no longer exists
    if (selectedId.value && !memory.value.sessions.some(s => s.id === selectedId.value)) {
      selectedId.value = null
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    memory.value = null
  } finally {
    loading.value = false
  }
}

watch(() => props.agent?.name, load, { immediate: true })
watch(() => props.refreshKey, () => { void load() })

const stats = computed(() => memory.value?.stats ?? null)
const topTools = computed(() => {
  if (!stats.value) return []
  return Object.entries(stats.value.toolCallsByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
})

function onRecall(s: MemorySession) {
  selectedId.value = s.id
  emit('recall', s)
}

function formatSessionRange(s: MemorySession): string {
  const start = new Date(s.startedAt)
  const end = new Date(s.endedAt)
  const sameDay = start.toDateString() === end.toDateString()
  if (sameDay) {
    const date = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const t1 = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    const t2 = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    if (t1 === t2) return `${date}, ${t1}`
    return `${date}, ${t1}–${t2}`
  }
  return `${start.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} → ${end.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
}
</script>

<template>
  <section class="card memory" data-testid="agent-memory">
    <header class="card-head">
      <h2 class="title"><span class="brain">🧠</span> Memory</h2>
      <div class="head-actions">
        <button
          type="button"
          class="btn ghost small"
          :disabled="loading || !agent?.name"
          title="Reload memory from disk"
          @click="load"
        >
          {{ loading ? '…' : 'Refresh' }}
        </button>
      </div>
    </header>

    <p v-if="!agent?.name" class="hint">Select an agent to see its on-disk memory.</p>

    <template v-else>
      <p v-if="loading && !memory" class="hint pulse">Loading memory…</p>
      <p v-else-if="error" class="banner">{{ error }}</p>

      <template v-else-if="memory">
        <!-- Empty state with meaningful hint derived from file absence -->
        <div v-if="memory.empty" class="empty">
          <p class="empty-title">No history yet</p>
          <p class="hint">
            This agent has no <code>memory.json</code> history. Chat to create the first checkpoint — it persists to
            <code>agents/{{ agent.name }}/memory.json</code>.
          </p>
          <ul class="empty-meta mono">
            <li>threads: {{ memory.threads.length || 0 }}</li>
            <li>checkpoints: {{ memory.checkpointCount }}</li>
          </ul>
        </div>

        <template v-else>
          <!-- Summary line (generated server-side) -->
          <p class="summary">{{ memory.summary }}</p>

          <!-- Stat grid -->
          <div class="grid">
            <div class="stat">
              <span class="k">Messages</span>
              <span class="v">{{ stats?.totalMessages }}</span>
              <span class="sub mono">{{ stats?.humanCount }} you · {{ stats?.aiCount }} agent · {{ stats?.toolCount }} tool</span>
            </div>
            <div class="stat">
              <span class="k">Checkpoints</span>
              <span class="v">{{ memory.checkpointCount }}</span>
              <span class="sub mono">{{ memory.threads.join(', ') }} · {{ memory.sessions.length }} session{{ memory.sessions.length !== 1 ? 's' : '' }}</span>
            </div>
            <div class="stat">
              <span class="k">Last active</span>
              <span class="v mono small">{{ timeAgo(memory.lastActive) }}</span>
              <span v-if="memory.lastActive" class="sub mono" :title="memory.lastActive">{{ new Date(memory.lastActive).toLocaleString() }}</span>
            </div>
            <div class="stat">
              <span class="k">ETH moved</span>
              <span class="v mono">{{ stats && Number(stats.totalEthSent) > 0 ? (Number(stats.totalEthSent).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' ETH') : '—' }}</span>
              <span class="sub mono">{{ stats?.txHashes.length ?? 0 }} tx · {{ stats?.uniqueRecipients.length ?? 0 }} recipient{{ (stats?.uniqueRecipients.length ?? 0) === 1 ? '' : 's' }}</span>
            </div>
          </div>

          <!-- Tool chips -->
          <div v-if="topTools.length" class="chips">
            <span v-for="[name, n] in topTools" :key="name" class="chip mono" :title="`${name} called ${n} times`">
              <span class="chip-name">{{ name }}</span>
              <span class="chip-count">×{{ n }}</span>
            </span>
          </div>

          <!-- Recipients & Txs -->
          <div class="lists">
            <div v-if="stats?.uniqueRecipients.length" class="list-block">
              <span class="list-label">Recipients</span>
              <div class="addr-list">
                <a
                  v-for="a in stats.uniqueRecipients.slice(0, 6)"
                  :key="a"
                  class="mono addr"
                  :href="`${explorerBase}/address/${a}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="a"
                  >{{ shortAddr(a) }} ↗</a
                >
                <span v-if="(stats.uniqueRecipients.length ?? 0) > 6" class="mono more">+{{ (stats.uniqueRecipients.length ?? 0) - 6 }} more</span>
              </div>
            </div>

            <div v-if="memory.recentTxHashes.length" class="list-block">
              <span class="list-label">Recent txs</span>
              <div class="addr-list">
                <a
                  v-for="h in memory.recentTxHashes.slice(0, 5)"
                  :key="h"
                  class="mono addr"
                  :href="`${explorerBase}/tx/${h}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="h"
                  >{{ shortTx(h) }} ↗</a
                >
              </div>
            </div>
          </div>

          <!-- Sessions (interactive) -->
          <div class="sessions-head">
            <span class="list-label">Sessions</span>
            <span class="mono small muted">{{ memory.sessions.length }} session{{ memory.sessions.length !== 1 ? 's' : '' }} · click to recall</span>
          </div>

          <div v-if="!memory.sessions.length" class="hint">No sessions detected.</div>

          <div v-else class="session-list" role="list">
            <button
              v-for="s in memory.sessions"
              :key="s.id"
              role="listitem"
              type="button"
              class="session-card"
              :class="{ selected: selectedId === s.id }"
              :aria-selected="selectedId === s.id ? 'true' : 'false'"
              :title="`Recall ${s.title} to chat`"
              @click="onRecall(s)"
            >
              <div class="session-head">
                <span class="session-index mono">#{{ s.index + 1 }}</span>
                <span class="session-time mono">{{ timeAgo(s.startedAt) }}</span>
              </div>
              <div class="session-title">{{ s.title }}</div>
              <div class="session-range mono">{{ formatSessionRange(s) }}</div>
              <div class="session-preview" :title="s.preview">“{{ s.preview }}”</div>
              <div class="session-meta mono">
                <span>{{ s.summary }}</span>
                <span v-if="s.humanCount"> · {{ s.humanCount }} prompt{{ s.humanCount !== 1 ? 's' : '' }}</span>
              </div>
              <div class="session-actions">
                <span class="recall-hint">↺ Recall to chat</span>
                <span v-if="selectedId === s.id" class="recall-active">✓ recalled</span>
              </div>
            </button>
          </div>

          <!-- Disk location footer -->
          <p class="foot mono">on disk: <code>agents/{{ agent.name }}/memory.json</code> · {{ memory.checkpointCount }} checkpoints · {{ memory.sessions.length }} sessions (20 min idle gap)</p>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1rem 1.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}
.card-head h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.brain { font-size: 1rem; line-height: 1; }
.head-actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
.btn.small { padding: 0.35rem 0.65rem; font-size: 0.75rem; }
.hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.45;
}
.hint code {
  font-family: var(--font-mono);
  font-size: 0.78em;
  background: color-mix(in oklab, var(--border) 60%, transparent);
  padding: 0.12em 0.3em;
  border-radius: 0.25em;
}
.banner {
  margin: 0;
  padding: 0.55rem 0.65rem;
  background: color-mix(in oklab, var(--warn) 12%, var(--surface));
  color: var(--warn);
  font-size: 0.82rem;
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  word-break: break-all;
}
.pulse { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:.5}50%{opacity:1}}

.empty {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border: 1px dashed var(--border);
  border-radius: 0.45rem;
  background: color-mix(in oklab, var(--bg) 60%, var(--surface));
}
.empty-title { margin: 0; font-size: 0.85rem; font-weight: 600; }
.empty-meta { margin: 0; display: flex; gap: 0.8rem; font-size: 0.72rem; color: var(--muted); list-style: none; padding: 0; }

.summary {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.45;
  color: var(--ink);
  background: color-mix(in oklab, var(--accent) 7%, var(--surface));
  border: 1px solid color-mix(in oklab, var(--accent) 18%, var(--border));
  padding: 0.55rem 0.65rem;
  border-radius: 0.45rem;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.6rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  background: var(--bg);
  min-width: 0;
}
.stat .k {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.stat .v {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.1;
  color: var(--ink);
}
.stat .v.small { font-size: 0.85rem; }
.stat .sub {
  font-size: 0.68rem;
  color: var(--muted);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono { font-family: var(--font-mono, ui-monospace, monospace); }

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.22rem 0.5rem;
  border-radius: 999px;
  background: var(--surface-2, color-mix(in oklab, var(--border) 45%, var(--surface)));
  border: 1px solid var(--border);
  font-size: 0.72rem;
}
.chip-name { color: var(--ink); }
.chip-count { color: var(--muted); font-weight: 600; }

.lists { display: flex; flex-direction: column; gap: 0.55rem; }
.list-block { display: flex; flex-direction: column; gap: 0.3rem; }
.list-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.addr-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}
.addr {
  font-size: 0.73rem;
  color: var(--accent);
  text-decoration: none;
  padding: 0.18rem 0.4rem;
  border: 1px solid color-mix(in oklab, var(--accent) 20%, var(--border));
  border-radius: 0.3rem;
  background: color-mix(in oklab, var(--accent) 6%, var(--surface));
}
.addr:hover { text-decoration: underline; }
.more { font-size: 0.72rem; color: var(--muted); }

.sessions-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 0.2rem;
}
.small { font-size: 0.7rem; }
.muted { color: var(--muted); }

.session-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 22rem;
  overflow-y: auto;
  padding-right: 0.2rem;
  scrollbar-width: thin;
}

.session-card {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  padding: 0.7rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.1s ease;
  width: 100%;
  font: inherit;
  color: inherit;
}

.session-card:hover {
  border-color: color-mix(in oklab, var(--accent) 28%, var(--border));
  background: color-mix(in oklab, var(--accent) 5%, var(--bg));
  transform: translateY(-1px);
}

.session-card:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--accent) 55%, transparent);
  outline-offset: 1px;
}

.session-card.selected {
  border-color: var(--accent);
  background: color-mix(in oklab, var(--accent) 9%, var(--bg));
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent) 18%, transparent);
}

.session-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.session-index {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--accent) 22%, var(--border));
  padding: 0.12rem 0.35rem;
  border-radius: 0.3rem;
  line-height: 1;
}

.session-time {
  font-size: 0.68rem;
  color: var(--muted);
}

.session-title {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.2;
}

.session-range {
  font-size: 0.68rem;
  color: var(--muted);
}

.session-preview {
  font-size: 0.78rem;
  color: color-mix(in oklab, var(--muted) 90%, var(--ink));
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: color-mix(in oklab, var(--surface) 70%, var(--bg));
  border: 1px dashed color-mix(in oklab, var(--border) 70%, transparent);
  padding: 0.3rem 0.45rem;
  border-radius: 0.35rem;
}

.session-meta {
  font-size: 0.7rem;
  color: var(--muted);
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.session-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.1rem;
}

.recall-hint {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--accent);
  opacity: 0.9;
}

.session-card:hover .recall-hint {
  opacity: 1;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.recall-active {
  font-size: 0.7rem;
  font-weight: 700;
  color: #6ecf8e;
  background: color-mix(in oklab, #6ecf8e 14%, var(--bg));
  border: 1px solid color-mix(in oklab, #6ecf8e 28%, var(--border));
  padding: 0.1rem 0.35rem;
  border-radius: 999px;
}

.foot {
  margin: 0.1rem 0 0;
  font-size: 0.68rem;
  color: var(--muted);
  word-break: break-all;
}
.foot code {
  font-size: 0.95em;
  padding: 0.1em 0.28em;
  border-radius: 0.25em;
  background: color-mix(in oklab, var(--border) 55%, transparent);
}
</style>
