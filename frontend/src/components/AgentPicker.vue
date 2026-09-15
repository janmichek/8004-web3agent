<script setup lang="ts">
import { computed, onMounted, ref, unref, watch } from 'vue'
import { useBalance } from '@wagmi/vue'
import { formatEther, isAddress, type Address } from 'viem'
import { fetchAgents, type AgentSummary } from '../api'

const props = defineProps<{
  selectName?: string | null
  agent?: AgentSummary | null
  scanId?: string | null
  scanUrl?: string | null
  refreshKey?: number
}>()

const addr = computed<Address | undefined>(() =>
  props.agent?.walletAddress && isAddress(props.agent.walletAddress)
    ? (props.agent.walletAddress as Address)
    : undefined,
)
const hasTarget = computed(() => Boolean(addr.value))
const eth = useBalance({ address: addr, query: { enabled: hasTarget } })

const ethDisplay = computed(() => {
  if (!addr.value) return '—'
  if (unref(eth.isFetching) && unref(eth.data) === undefined) return '…'
  if (unref(eth.error)) return 'Error'
  const d = unref(eth.data)
  if (d?.value === undefined) return '—'
  return `${Number(formatEther(d.value)).toPrecision(6)} ETH`
})

const walletScanUrl = computed(() => {
  const address = props.agent?.walletAddress
  if (!address) return null
  const chainId = props.agent?.walletChainId ?? 421614
  const base = chainId === 42161 ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io'
  return `${base}/address/${address}`
})

watch(
  () => props.refreshKey,
  () => {
    if (hasTarget.value) void eth.refetch()
  },
)

const agents = ref<AgentSummary[]>([])
const selected = ref('')
const loadError = ref('')

const emit = defineEmits<{
  select: [agent: AgentSummary | null]
  create: []
}>()

async function loadAgents() {
  loadError.value = ''
  try {
    const data = await fetchAgents()
    agents.value = data.agents
    if (props.selectName && data.agents.some((a) => a.name === props.selectName)) {
      selected.value = props.selectName
    } else if (!selected.value && data.agents[0]) {
      selected.value = data.agents[0].name
    } else if (selected.value && !data.agents.some((a) => a.name === selected.value)) {
      selected.value = data.agents[0]?.name ?? ''
    }
  } catch (err) {
    loadError.value =
      err instanceof Error
        ? err.message
        : 'API unavailable — run npm run serve'
  }
}

watch(selected, (name) => {
  const agent = agents.value.find((a) => a.name === name) ?? null
  emit('select', agent)
})

watch(
  () => props.selectName,
  (name) => {
    if (name && agents.value.some((a) => a.name === name)) {
      selected.value = name
    } else if (name) {
      void loadAgents()
    }
  },
)

async function refreshAll() {
  if (hasTarget.value) void eth.refetch()
  await loadAgents()
}

onMounted(() => {
  void loadAgents()
})
</script>

<template>
  <section class="card">
    <header class="card-head">
      <h2>Agent</h2>
      <div class="head-actions">
        <button type="button" class="btn ghost small" @click="refreshAll">Refresh</button>
        <button type="button" class="btn primary small" @click="emit('create')">
          Create agent
        </button>
      </div>
    </header>

    <div class="pick">
      <label for="agent-select">Selection</label>
      <select id="agent-select" v-model="selected" data-testid="agent-select" :disabled="!agents.length">
        <option v-if="!agents.length" value="">No agents</option>
        <option v-for="a in agents" :key="a.name" :value="a.name">
          {{ a.name }}
        </option>
      </select>
    </div>

    <p v-if="loadError" class="banner">{{ loadError }}</p>
    <p v-else-if="!agents.length" class="hint">
      No agents yet — create one to get started (same flow as <code>npm run create-agent</code>).
    </p>

    <div v-if="agent" class="details">
      <dl>
        <div v-if="agent.walletAddress">
          <dt>Wallet</dt>
          <dd class="mono">
            <a
              v-if="walletScanUrl"
              :href="walletScanUrl"
              target="_blank"
              rel="noopener noreferrer"
              >{{ agent.walletAddress }} ↗</a
            >
            <span v-else>{{ agent.walletAddress }}</span>
          </dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd class="mono">{{ ethDisplay }}</dd>
        </div>
        <div v-if="agent.agentId">
          <dt>ERC-8004</dt>
          <dd class="mono">
            <a v-if="scanUrl && scanId" :href="scanUrl" target="_blank" rel="noopener noreferrer">#{{ scanId }} ↗</a>
            <span v-else>#{{ agent.agentId }}</span>
          </dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{{ agent.tools.join(', ') || 'none' }}</dd>
        </div>
        <div>
          <dt>Actions</dt>
          <dd>{{ agent.actions.join(', ') || 'none' }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
}

.pick {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.pick label {
  font-size: 0.72rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pick select {
  font: inherit;
  font-size: 0.9rem;
  padding: 0.45rem 0.55rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
}

.pick select:disabled {
  opacity: 0.6;
}

.banner {
  margin: 0;
  padding: 0.55rem 0.65rem;
  background: color-mix(in oklab, var(--warn) 12%, var(--surface));
  color: var(--warn);
  font-size: 0.82rem;
  border: 1px solid var(--border);
  border-radius: 0.4rem;
}

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

.btn.small {
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
}

.details {
  padding-top: 0;
}

.details dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.details dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.details dd {
  margin: 0.15rem 0 0;
  font-size: 0.85rem;
  word-break: break-all;
}

.details dd a {
  color: var(--accent);
  text-decoration: none;
}

.details dd a:hover {
  text-decoration: underline;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}
</style>
