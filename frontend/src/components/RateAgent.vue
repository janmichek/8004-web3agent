<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAccount } from '@wagmi/vue'
import { fetchReputation, scanUrlForAgent, submitFeedback } from '../api'

const props = defineProps<{
  /** Local agent name used for the feedback API route. */
  agentName: string
  /** Default target agent ID, e.g. "421614:204". */
  defaultAgentId?: string
  walletChainId?: number
  owners?: string[]
  operators?: string[]
  /** Optional tx hash of the successful transaction being rated (display only). */
  txHash?: string
}>()

const emit = defineEmits<{
  rated: [payload: { txHash: string; scanUrl: string }]
}>()

const { address: wagmiAddress } = useAccount()

/** Playwright can set window.__E2E_CONNECTED_ADDRESS to simulate a connected wallet. */
const connected = computed(() => {
  if (typeof window !== 'undefined') {
    const forced = (window as unknown as { __E2E_CONNECTED_ADDRESS?: string }).__E2E_CONNECTED_ADDRESS
    if (forced) return forced as `0x${string}`
  }
  return wagmiAddress.value
})

const agentId = computed(() => props.defaultAgentId?.trim() ?? '')
const stars = ref(5)
const tag = ref('transfer')
const comment = ref('')
const busy = ref(false)
const error = ref('')
const resultTx = ref('')
const scanUrl = ref('')
const reputation = ref<{ count: number; averageValue: number } | null>(null)
const loadingRep = ref(false)

const value = computed(() => stars.value * 20)

function addrIn(list: string[] | undefined, addr?: string): boolean {
  if (!addr || !list?.length) return false
  const a = addr.toLowerCase()
  return list.some((x) => x.toLowerCase() === a)
}

/** Connected wallet cannot rate if it is owner or operator of this agent. */
const blockedAsOwnerOrOperator = computed(() => {
  return (
    addrIn(props.owners, connected.value) || addrIn(props.operators, connected.value)
  )
})

const canSubmit = computed(() => {
  return Boolean(
    props.agentName &&
      agentId.value.trim() &&
      !busy.value &&
      !blockedAsOwnerOrOperator.value,
  )
})

const previewScanUrl = computed(() => {
  const id = agentId.value.trim()
  if (!id) return ''
  return scanUrlForAgent(id, props.walletChainId ?? 421614)
})

function setStars(n: number) {
  stars.value = n
}

async function loadReputation() {
  const id = agentId.value.trim()
  if (!id) {
    reputation.value = null
    return
  }
  loadingRep.value = true
  try {
    reputation.value = await fetchReputation(id)
  } catch {
    reputation.value = null
  } finally {
    loadingRep.value = false
  }
}

watch(agentId, () => {
  void loadReputation()
})

async function submit() {
  if (!canSubmit.value) return
  busy.value = true
  error.value = ''
  resultTx.value = ''
  scanUrl.value = ''
  try {
    const res = await submitFeedback(props.agentName, {
      agentId: agentId.value.trim(),
      value: value.value,
      tag: tag.value.trim() || undefined,
      comment: comment.value.trim() || undefined,
    })
    resultTx.value = res.txHash
    scanUrl.value = res.scanUrl || previewScanUrl.value
    reputation.value = res.reputation
    emit('rated', { txHash: res.txHash, scanUrl: scanUrl.value })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

void loadReputation()
</script>

<template>
  <section class="rate" aria-label="Rate agent" data-testid="rate-agent">
    <header class="head">
      <h2>Rate agent</h2>
      <p class="sub">On-chain ERC-8004 feedback (0–100)</p>
    </header>

    <p v-if="blockedAsOwnerOrOperator" class="hint warn" data-testid="rate-disabled">
      Connected wallet is an owner or operator of this agent — self-feedback is not allowed.
      Disconnect or use another wallet to rate.
    </p>

    <p class="rep" aria-live="polite">
      <template v-if="loadingRep">Loading reputation…</template>
      <template v-else-if="reputation"
        >★ {{ reputation.averageValue.toFixed(1) }}/100 · {{ reputation.count }} rating{{
          reputation.count === 1 ? '' : 's'
        }}</template
      >
      <template v-else-if="agentId.trim()">No reputation found (or lookup failed).</template>
    </p>

    <div class="stars" role="radiogroup" aria-label="Rating">
      <button
        v-for="n in 5"
        :key="n"
        type="button"
        class="star"
        :class="{ on: n <= stars }"
        :aria-pressed="n === stars"
        :aria-label="`${n} star${n === 1 ? '' : 's'} (${n * 20}/100)`"
        :disabled="busy || blockedAsOwnerOrOperator"
        @click="setStars(n)"
      >
        ★
      </button>
      <span class="val mono">{{ value }}/100</span>
    </div>

    <label class="field">
      <span>Tag</span>
      <input
        v-model="tag"
        type="text"
        placeholder="transfer"
        spellcheck="false"
        data-testid="rate-tag"
        :disabled="busy || blockedAsOwnerOrOperator"
      />
    </label>

    <label class="field">
      <span>Comment (optional)</span>
      <input
        v-model="comment"
        type="text"
        placeholder="Fast, smooth transfer"
        data-testid="rate-comment"
        :disabled="busy || blockedAsOwnerOrOperator"
      />
    </label>

    <button
      class="btn primary"
      type="button"
      data-testid="rate-submit"
      :disabled="!canSubmit"
      @click="submit"
    >
      {{ busy ? 'Submitting…' : `Submit ${value}/100 rating` }}
    </button>

    <p v-if="resultTx" class="status ok mono" data-testid="rate-result">
      Rated ✓ {{ resultTx.slice(0, 18) }}…
    </p>
    <p v-if="scanUrl || (resultTx && previewScanUrl)" class="scan" data-testid="rate-scan-link">
      View on 8004scan:
      <a :href="scanUrl || previewScanUrl" target="_blank" rel="noopener noreferrer">{{
        scanUrl || previewScanUrl
      }}</a>
    </p>
    <p v-if="error" class="status error" data-testid="rate-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.rate {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1rem 1.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  align-self: stretch;
  max-width: min(36rem, 100%);
}
.head h2 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}
.sub {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.76rem;
  word-break: break-all;
}
.hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
}
.hint.warn {
  color: var(--warn, #e8a54b);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.72rem;
  color: var(--muted);
}
.field input {
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
}
.rep {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}
.target {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
  word-break: break-all;
}
.stars {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}
.star {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.5rem;
  line-height: 1;
  color: var(--border);
  padding: 0.1rem;
}
.star.on {
  color: #f5b942;
}
.star:disabled {
  cursor: default;
  opacity: 0.6;
}
.val {
  margin-left: 0.5rem;
  font-size: 0.8rem;
  color: var(--muted);
}
.status {
  margin: 0;
  font-size: 0.78rem;
  word-break: break-all;
}
.status.ok {
  color: #6ecf8e;
}
.status.error {
  color: #ffb4b0;
}
.scan {
  margin: 0;
  font-size: 0.78rem;
  word-break: break-all;
}
.scan a {
  color: var(--accent);
}
</style>
