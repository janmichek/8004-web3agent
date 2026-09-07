<script setup lang="ts">
import { ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import WalletBar from './components/WalletBar.vue'
import BalancePanel from './components/BalancePanel.vue'
import FundAgent from './components/FundAgent.vue'
import AgentChat from './components/AgentChat.vue'
import type { AgentSummary } from './api'

const selectedAgent = ref<AgentSummary | null>(null)
const refreshKey = ref(0)
const queryClient = useQueryClient()

function onSelect(agent: AgentSummary | null) {
  selectedAgent.value = agent
}

function onFunded() {
  refreshKey.value += 1
  void queryClient.invalidateQueries()
}
</script>

<template>
  <div class="shell">
    <WalletBar />

    <main class="layout">
      <aside class="side">
        <BalancePanel label="Your wallet" :refresh-key="refreshKey" />
        <BalancePanel
          v-if="selectedAgent?.walletAddress"
          label="Agent wallet"
          :watch-address="selectedAgent.walletAddress"
          :refresh-key="refreshKey"
        />
        <FundAgent
          :agent-address="selectedAgent?.walletAddress"
          :agent-name="selectedAgent?.name"
          @funded="onFunded"
        />

        <section v-if="selectedAgent" class="meta">
          <h2>{{ selectedAgent.name }}</h2>
          <dl>
            <div v-if="selectedAgent.agentId">
              <dt>ERC-8004</dt>
              <dd class="mono">{{ selectedAgent.agentId }}</dd>
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
        <AgentChat @select="onSelect" />
      </div>
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.layout {
  flex: 1;
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
}

.main {
  min-height: 0;
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

@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
    padding: 1rem;
  }
}
</style>
