<script setup lang="ts">
import { computed, ref, unref, watch } from 'vue'
import { useBalance } from '@wagmi/vue'
import { formatEther, isAddress, type Address } from 'viem'
import { fundAgent } from '../api'

const props = defineProps<{ agentAddress?: string; agentName?: string; refreshKey?: number }>()
const emit = defineEmits<{ funded: [txHash: string] }>()

const amount = ref('0.001')
const statusText = ref('')
const statusKind = ref<'info' | 'ok' | 'error'>('info')
const busy = ref(false)

const addr = computed<Address | undefined>(() =>
  props.agentAddress && isAddress(props.agentAddress) ? (props.agentAddress as Address) : undefined,
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

watch(() => props.refreshKey, () => { if (hasTarget.value) void eth.refetch() })

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
    void eth.refetch()
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
      <h2>Agent wallet</h2>
      <button type="button" class="btn ghost small" :disabled="!addr" @click="eth.refetch()">Refresh</button>
    </header>

    <p v-if="!addr" class="hint">Select an agent with a wallet address.</p>
    <template v-else>
      <div class="bal">
        <span class="sym">ETH</span>
        <span class="amt mono">{{ ethDisplay }}</span>
      </div>
      <h3 class="fund-heading">Fund agent</h3>

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
.fund-heading { margin:0; font-size:0.85rem; font-weight:600; }
.hint { margin:0; font-size:0.85rem; color:var(--muted); }
.bal { display:flex; justify-content:space-between; align-items:baseline; padding:0.6rem 0.75rem; background:var(--surface-2); border-radius:0.4rem; }
.sym { font-size:0.8rem; font-weight:600; color:var(--muted); }
.amt { font-size:0.95rem; }
.form { display:flex; flex-direction:column; gap:0.6rem; }
.field { display:flex; flex-direction:column; gap:0.3rem; font-size:0.75rem; color:var(--muted); }
.field input { font:inherit; font-family:var(--font-mono); font-size:0.9rem; padding:0.6rem 0.75rem; border-radius:0.4rem; border:1px solid var(--border); background:var(--bg); color:var(--ink); }
.status { margin:0; font-size:0.78rem; word-break:break-all; }
.status.info{color:var(--muted)} .status.ok{color:#6ecf8e} .status.error{color:#ffb4b0}
.btn.small{padding:0.3rem 0.6rem; font-size:0.72rem}
</style>
