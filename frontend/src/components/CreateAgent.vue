<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  createAgent,
  fetchCatalog,
  type AgentSummary,
  type CatalogResponse,
  type CreateAgentStep,
} from '../api'

type Phase =
  | 'env'
  | 'name'
  | 'configure'
  | 'pick-actions'
  | 'pick-tools'
  | 'fund'
  | 'creating'
  | 'done'
  | 'error'

const emit = defineEmits<{
  created: [agent: AgentSummary]
  cancel: []
}>()

const phase = ref<Phase>('env')
const catalog = ref<CatalogResponse | null>(null)
const loadError = ref('')
const createError = ref('')
const busy = ref(false)

const agentName = ref('')
const selectedActions = ref<string[]>([])
const selectedTools = ref<string[]>([])
const fundEth = ref('0.002')
const skipRegister = ref(false)

const createSteps = ref<CreateAgentStep[]>([])
const createdAgent = ref<AgentSummary | null>(null)
const createdBalance = ref('')

const actionToolNames = computed(() => {
  const names = new Set<string>()
  for (const actionName of selectedActions.value) {
    const entry = catalog.value?.actions.find((a) => a.name === actionName)
    if (entry) for (const t of entry.toolNames) names.add(t)
  }
  return names
})

const selectionSummary = computed(() => {
  const lines: string[] = []
  if (selectedActions.value.length) {
    lines.push(`Actions: ${selectedActions.value.join(', ')}`)
    lines.push(`  Tools: ${[...actionToolNames.value].join(', ')}`)
  }
  if (selectedTools.value.length) {
    lines.push(`Standalone tools: ${selectedTools.value.join(', ')}`)
  }
  return lines.length ? lines.join('\n') : '(nothing selected)'
})

const nameValid = computed(() =>
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/.test(agentName.value.trim()),
)

const fundValid = computed(() => {
  const n = Number(fundEth.value)
  return Number.isFinite(n) && n >= 0 && n <= 1
})

async function loadCatalog() {
  loadError.value = ''
  try {
    catalog.value = await fetchCatalog()
  } catch (err) {
    loadError.value =
      err instanceof Error ? err.message : 'Failed to load catalog — is the API running?'
  }
}

onMounted(() => {
  void loadCatalog()
})

function toggleAction(name: string) {
  const i = selectedActions.value.indexOf(name)
  if (i >= 0) selectedActions.value.splice(i, 1)
  else selectedActions.value.push(name)
  // Drop standalone tools that are now included via an action
  selectedTools.value = selectedTools.value.filter((t) => !actionToolNames.value.has(t))
}

function toggleTool(name: string) {
  if (actionToolNames.value.has(name)) return
  const i = selectedTools.value.indexOf(name)
  if (i >= 0) selectedTools.value.splice(i, 1)
  else selectedTools.value.push(name)
}

function goConfigure() {
  if (!nameValid.value) return
  phase.value = 'configure'
}

async function submitCreate() {
  if (!fundValid.value || busy.value) return
  phase.value = 'creating'
  createError.value = ''
  createSteps.value = []
  createdAgent.value = null
  busy.value = true

  try {
    const res = await createAgent({
      name: agentName.value.trim(),
      actions: selectedActions.value,
      tools: selectedTools.value,
      fundEth: fundEth.value.trim() || '0.002',
      skipRegister: skipRegister.value,
    })
    createSteps.value = res.steps
    createdAgent.value = res.agent
    createdBalance.value = res.balanceEth
    phase.value = 'done'
  } catch (err) {
    createError.value = err instanceof Error ? err.message : String(err)
    phase.value = 'error'
  } finally {
    busy.value = false
  }
}

function openChat() {
  if (createdAgent.value) emit('created', createdAgent.value)
}

function shortAddr(addr?: string) {
  if (!addr) return '—'
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`
}
</script>

<template>
  <section class="wizard">
    <header class="head">
      <h2>Create agent</h2>
      <button type="button" class="btn ghost small" :disabled="busy" @click="emit('cancel')">
        Cancel
      </button>
    </header>

    <p v-if="loadError" class="banner">{{ loadError }}</p>

    <!-- Environment -->
    <div v-else-if="phase === 'env'" class="body">
      <p class="step-label">Environment</p>
      <dl v-if="catalog" class="env">
        <div>
          <dt>Network</dt>
          <dd>{{ catalog.networkName }} ({{ catalog.network }})</dd>
        </div>
        <div>
          <dt>Master</dt>
          <dd class="mono">{{ shortAddr(catalog.master.address) }}</dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd class="mono">{{ catalog.master.balanceEth ?? '—' }} ETH</dd>
        </div>
      </dl>
      <p v-else class="hint">Loading environment…</p>
      <div class="nav">
        <button type="button" class="btn primary" :disabled="!catalog" @click="phase = 'name'">
          Continue
        </button>
      </div>
    </div>

    <!-- Name -->
    <div v-else-if="phase === 'name'" class="body">
      <p class="step-label">Agent name</p>
      <label class="field">
        <span>Name</span>
        <input
          v-model="agentName"
          type="text"
          placeholder="my-agent"
          spellcheck="false"
          autofocus
          @keydown.enter.prevent="goConfigure"
        />
      </label>
      <p class="hint">Letters, numbers, . _ - (1–63 chars)</p>
      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'env'">Back</button>
        <button type="button" class="btn primary" :disabled="!nameValid" @click="goConfigure">
          Continue
        </button>
      </div>
    </div>

    <!-- Configure menu (mirrors CLI select loop) -->
    <div v-else-if="phase === 'configure'" class="body">
      <p class="step-label">Configure your agent</p>
      <div class="menu">
        <button type="button" class="menu-item" @click="phase = 'pick-actions'">
          <span class="menu-title">Actions</span>
          <span class="menu-hint">Opinionated bundles (skill + tools)</span>
        </button>
        <button type="button" class="menu-item" @click="phase = 'pick-tools'">
          <span class="menu-title">Tools</span>
          <span class="menu-hint">Standalone tools, no reasoning layer</span>
        </button>
        <button type="button" class="menu-item primary" @click="phase = 'fund'">
          <span class="menu-title">Continue</span>
          <span class="menu-hint">Proceed with current selection</span>
        </button>
      </div>
      <pre class="summary">{{ selectionSummary }}</pre>
      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'name'">Back</button>
      </div>
    </div>

    <!-- Pick actions -->
    <div v-else-if="phase === 'pick-actions'" class="body">
      <p class="step-label">Select actions</p>
      <ul class="checklist">
        <li v-for="a in catalog?.actions ?? []" :key="a.name">
          <label class="check">
            <input
              type="checkbox"
              :checked="selectedActions.includes(a.name)"
              @change="toggleAction(a.name)"
            />
            <span>
              <strong>{{ a.name }}</strong>
              <em>{{ a.description }} [tools: {{ a.toolNames.join(', ') }}]</em>
            </span>
          </label>
        </li>
      </ul>
      <div class="nav">
        <button type="button" class="btn primary" @click="phase = 'configure'">Done</button>
      </div>
    </div>

    <!-- Pick tools -->
    <div v-else-if="phase === 'pick-tools'" class="body">
      <p class="step-label">Select tools</p>
      <ul class="checklist">
        <li v-for="t in catalog?.tools ?? []" :key="t.name">
          <label class="check" :class="{ disabled: actionToolNames.has(t.name) }">
            <input
              type="checkbox"
              :checked="selectedTools.includes(t.name) || actionToolNames.has(t.name)"
              :disabled="actionToolNames.has(t.name)"
              @change="toggleTool(t.name)"
            />
            <span>
              <strong>{{ t.name }}</strong>
              <em>
                {{
                  actionToolNames.has(t.name)
                    ? `${t.description} (included via action)`
                    : t.description
                }}
              </em>
            </span>
          </label>
        </li>
      </ul>
      <div class="nav">
        <button type="button" class="btn primary" @click="phase = 'configure'">Done</button>
      </div>
    </div>

    <!-- Fund + register -->
    <div v-else-if="phase === 'fund'" class="body">
      <p class="step-label">Fund &amp; register</p>
      <label class="field">
        <span>ETH to fund agent</span>
        <input
          v-model="fundEth"
          type="text"
          inputmode="decimal"
          placeholder="0.002"
          spellcheck="false"
        />
      </label>
      <label class="check skip">
        <input v-model="skipRegister" type="checkbox" />
        <span>Skip ERC-8004 registration</span>
      </label>
      <pre class="summary">{{ selectionSummary }}</pre>
      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'configure'">Back</button>
        <button
          type="button"
          class="btn primary"
          :disabled="!fundValid || busy"
          @click="submitCreate"
        >
          Create agent
        </button>
      </div>
    </div>

    <!-- Creating -->
    <div v-else-if="phase === 'creating'" class="body">
      <p class="step-label">Creating “{{ agentName }}”…</p>
      <p class="hint creating-pulse">Wallet → fund → config → register</p>
    </div>

    <!-- Done -->
    <div v-else-if="phase === 'done' && createdAgent" class="body">
      <p class="step-label">Agent created</p>
      <dl class="env">
        <div>
          <dt>Name</dt>
          <dd>{{ createdAgent.name }}</dd>
        </div>
        <div v-if="createdAgent.agentId">
          <dt>Agent ID</dt>
          <dd class="mono">{{ createdAgent.agentId }}</dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd class="mono">{{ createdAgent.walletAddress }}</dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd class="mono">{{ createdBalance }} ETH</dd>
        </div>
        <div>
          <dt>Actions</dt>
          <dd>{{ createdAgent.actions.join(', ') || 'none' }}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{{ createdAgent.tools.join(', ') || 'none' }}</dd>
        </div>
      </dl>
      <ul v-if="createSteps.length" class="steps">
        <li v-for="s in createSteps" :key="s.step" :class="{ fail: !s.ok }">
          <span class="mono">{{ s.step }}</span>
          — {{ s.ok ? 'ok' : 'failed' }}
          <template v-if="s.detail"> · {{ s.detail }}</template>
        </li>
      </ul>
      <div class="nav">
        <button type="button" class="btn ghost" @click="emit('cancel')">Close</button>
        <button type="button" class="btn primary" @click="openChat">Open chat</button>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="phase === 'error'" class="body">
      <p class="step-label">Creation failed</p>
      <p class="banner">{{ createError }}</p>
      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'fund'">Back</button>
        <button type="button" class="btn primary" @click="submitCreate">Retry</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wizard {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid var(--border);
}

.head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 600;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.1rem 1.15rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.step-label {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.env {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.env dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.env dd {
  margin: 0.1rem 0 0;
  font-size: 0.88rem;
  word-break: break-all;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--muted);
}

.field input {
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.95rem;
  padding: 0.65rem 0.75rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
}

.field input:focus {
  outline: 2px solid color-mix(in oklab, var(--accent) 45%, transparent);
  outline-offset: 1px;
}

.hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}

.menu {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  text-align: left;
  font: inherit;
  padding: 0.75rem 0.85rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.menu-item:hover {
  background: var(--surface-2);
  border-color: color-mix(in oklab, var(--accent) 35%, var(--border));
}

.menu-item.primary {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
  background: color-mix(in oklab, var(--accent) 12%, var(--bg));
}

.menu-title {
  font-weight: 600;
  font-size: 0.92rem;
}

.menu-hint {
  font-size: 0.78rem;
  color: var(--muted);
}

.summary {
  margin: 0;
  padding: 0.65rem 0.75rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
}

.checklist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.check {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  padding: 0.65rem 0.75rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border);
  background: var(--bg);
  cursor: pointer;
}

.check.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.check.skip {
  border: none;
  background: transparent;
  padding: 0.25rem 0;
}

.check strong {
  display: block;
  font-size: 0.88rem;
}

.check em {
  display: block;
  margin-top: 0.15rem;
  font-style: normal;
  font-size: 0.78rem;
  color: var(--muted);
}

.check input {
  margin-top: 0.2rem;
  accent-color: var(--accent);
}

.nav {
  display: flex;
  justify-content: flex-end;
  gap: 0.55rem;
  margin-top: auto;
  padding-top: 0.5rem;
}

.banner {
  margin: 0;
  padding: 0.65rem 1rem;
  background: color-mix(in oklab, var(--warn) 12%, var(--surface));
  color: var(--warn);
  font-size: 0.82rem;
  border-bottom: 1px solid var(--border);
}

.body .banner {
  border: 1px solid color-mix(in oklab, #c44 40%, var(--border));
  border-radius: 0.4rem;
  background: color-mix(in oklab, #c44 14%, var(--surface));
  color: #ffb4b0;
}

.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.78rem;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.steps .fail {
  color: #ffb4b0;
}

.creating-pulse {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

.btn.small {
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
}
</style>
