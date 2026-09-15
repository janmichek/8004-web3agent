<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { isAddress, type Address } from 'viem'
import { fetchHealth, fundAgent } from '../api'

const props = defineProps<{ agentAddress?: string; agentName?: string; refreshKey?: number }>()
const emit = defineEmits<{ funded: [txHash: string] }>()

const amount = ref('0.001')
const statusText = ref('')
const statusKind = ref<'info' | 'ok' | 'error'>('info')
const busy = ref(false)
const masterAddress = ref('')
const masterChainId = ref(421614)

const masterScanUrl = computed(() => {
  if (!masterAddress.value) return null
  const base = masterChainId.value === 42161 ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io'
  return `${base}/address/${masterAddress.value}`
})

onMounted(() => {
  void fetchHealth()
    .then((h) => {
      if (h.master?.address) masterAddress.value = h.master.address
      if (h.chainId) masterChainId.value = h.chainId
    })
    .catch(() => {})
})

const addr = computed<Address | undefined>(() =>
  props.agentAddress && isAddress(props.agentAddress) ? (props.agentAddress as Address) : undefined,
)

const canSend = computed(() => {
  if (!props.agentName || !addr.value || busy.value) return false
  const n = Number(amount.value)
  return Number.isFinite(n) && n > 0 && n <= 1
})

function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Transfer failed'
  const line = (raw.split('\n')[0] || raw)
  if (/insufficient funds|insufficient balance/i.test(line)) return 'Master wallet has insufficient ETH.'
  if (/exceeds defined limit|limit exceeded|-32005|429/i.test(line)) return 'RPC rate limit hit. Wait a few seconds and retry.'
  return line
}

async function fund() {
  if (!canSend.value || !props.agentName) return
  statusText.value = 'Sending from master wallet…'
  statusKind.value = 'info'
  busy.value = true
  try {
    const r = await fundAgent(props.agentName, amount.value)
    statusText.value = `Sent ${r.txHash.slice(0, 10)}…`
    statusKind.value = 'ok'
    emit('funded', r.txHash)
  } catch (err) {
    statusText.value = friendlyError(err)
    statusKind.value = 'error'
  } finally { busy.value = false }
}
</script>

<template>
  <section class="panel">
    <header class="head">
      <h2>Fund agent</h2>
    </header>

    <div v-if="masterAddress" class="master">
      <dt>Master wallet</dt>
      <dd class="mono">
        <a
          v-if="masterScanUrl"
          :href="masterScanUrl"
          target="_blank"
          rel="noopener noreferrer"
          >{{ masterAddress }} ↗</a
        >
        <span v-else>{{ masterAddress }}</span>
      </dd>
    </div>

    <p v-if="!addr" class="hint">Select an agent with a wallet address.</p>
    <template v-else>
      <form class="form" @submit.prevent="fund">
        <label class="field">
          <span>Amount (ETH)</span>
          <input v-model="amount" type="text" inputmode="decimal" placeholder="0.001" :disabled="busy" />
        </label>
        <button class="btn primary" type="submit" :disabled="!canSend">{{ busy ? 'Sending…' : 'Send' }}</button>
      </form>
      <p v-if="statusText" class="status" :class="statusKind">{{ statusText }}</p>
    </template>
  </section>
</template>

<style scoped>
.panel { display:flex; flex-direction:column; gap:0.85rem; padding:1.15rem 1.2rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); }
.head { display:flex; justify-content:space-between; align-items:center; }
.head h2 { margin:0; font-size:0.95rem; font-weight:600; }
.sub { margin:0; color:var(--muted); font-size:0.75rem; }
.hint { margin:0; font-size:0.85rem; color:var(--muted); }
.form { display:flex; flex-direction:column; gap:0.6rem; }
.field { display:flex; flex-direction:column; gap:0.3rem; font-size:0.75rem; color:var(--muted); }
.field input { font:inherit; font-family:var(--font-mono); font-size:0.9rem; padding:0.6rem 0.75rem; border-radius:0.4rem; border:1px solid var(--border); background:var(--bg); color:var(--ink); }
.status { margin:0; font-size:0.78rem; word-break:break-all; }
.status.info{color:var(--muted)} .status.ok{color:#6ecf8e} .status.error{color:#ffb4b0}
.master dt { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); }
.master dd { margin:0.15rem 0 0; font-size:0.85rem; word-break:break-all; }
.master dd a { color:var(--accent); text-decoration:none; }
.master dd a:hover { text-decoration:underline; }
</style>
