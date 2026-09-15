<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import WalletBar from './components/WalletBar.vue'
import AgentWallet from './components/AgentWallet.vue'
import AgentChat from './components/AgentChat.vue'
import CreateAgent from './components/CreateAgent.vue'
import type { AgentSummary } from './api'

function networkSlug(chainId: number): string {
  if (chainId === 42161) return 'arbitrum-one'
  if (chainId === 421614) return 'arbitrum-sepolia'
  return 'arbitrum-sepolia'
}

const selectedAgent = ref<AgentSummary | null>(null)
const refreshKey = ref(0)
const showCreate = ref(false)
const pendingSelect = ref<string | null>(null)
const queryClient = useQueryClient()

function extractNumericId(agentId: string): string {
  // agentId may be "421614:204" or "eip155:421614:204" – we want the trailing numeric part
  const parts = agentId.split(':')
  return parts[parts.length - 1] || agentId
}

const scanId = computed(() => {
  if (!selectedAgent.value?.agentId) return null
  return extractNumericId(selectedAgent.value.agentId)
})

const scanUrl = computed(() => {
  if (!scanId.value) return null
  const slug = networkSlug(selectedAgent.value!.walletChainId)
  return `https://testnet.8004scan.io/agents/${slug}/${scanId.value}`
})

function onSelect(agent: AgentSummary | null) {
  selectedAgent.value = agent
  if (agent && agent.name === pendingSelect.value) {
    pendingSelect.value = null
  }
}

function onFunded() {
  refreshKey.value += 1
  void queryClient.invalidateQueries()
}

function onCreated(agent: AgentSummary) {
  showCreate.value = false
  selectedAgent.value = agent
  pendingSelect.value = agent.name
  refreshKey.value += 1
  void queryClient.invalidateQueries()
}
</script>

<template>
  <div class="shell">
    <WalletBar />

    <main class="layout">
      <aside class="side">
        <AgentWallet
          :agent-address="selectedAgent?.walletAddress"
          :agent-name="selectedAgent?.name"
          :refresh-key="refreshKey"
          @funded="onFunded"
        />

        <section v-if="selectedAgent" class="meta">
          <h2>{{ selectedAgent.name }}</h2>
          <dl>
            <div v-if="selectedAgent.walletAddress">
              <dt>Wallet</dt>
              <dd class="mono">{{ selectedAgent.walletAddress }}</dd>
            </div>
            <div v-if="selectedAgent.agentId">
              <dt>ERC-8004</dt>
              <dd class="mono">
                <a v-if="scanUrl && scanId" :href="scanUrl" target="_blank" rel="noopener noreferrer">#{{ scanId }} ↗</a>
                <span v-else>#{{ selectedAgent.agentId }}</span>
              </dd>
            </div>
            <div>
              <dt>Tools</dt>
              <dd>{{ selectedAgent.tools.join(', ') || 'none' }}</dd>
            </div>
            <div>
              <dt>Actions</dt>
              <dd>{{ selectedAgent.actions.join(', ') || 'none' }}</dd>
            </div>
          </dl>
        </section>
      </aside>

      <div class="main">
        <CreateAgent
          v-if="showCreate"
          @created="onCreated"
          @cancel="showCreate = false"
        />
        <AgentChat
          v-else
          :select-name="pendingSelect"
          @select="onSelect"
          @create="showCreate = true"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.layout {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(16rem, 22rem) 1fr;
  gap: 1.25rem;
  padding: 1.25rem 1.5rem 2rem;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
  overflow-y: auto;
}

.main {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.meta {
  padding: 1rem 1.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.meta h2 {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
}

.meta dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.meta dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.meta dd {
  margin: 0.15rem 0 0;
  font-size: 0.85rem;
  word-break: break-all;
}

.meta dd a {
  color: var(--accent);
  text-decoration: none;
}

.meta dd a:hover {
  text-decoration: underline;
}

@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
    padding: 1rem;
    overflow-y: auto;
  }
  .side {
    overflow: visible;
    flex-shrink: 0;
  }
  .main {
    flex: 1;
    min-height: 24rem;
  }
}
</style>
