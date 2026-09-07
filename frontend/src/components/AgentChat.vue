<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { chatWithAgent, fetchAgents, type AgentSummary, type ChatEvent } from '../api'

type Bubble =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'event'; event: ChatEvent }
  | { kind: 'error'; text: string }

const agents = ref<AgentSummary[]>([])
const selected = ref('')
const input = ref('')
const busy = ref(false)
const loadError = ref('')
const bubbles = ref<Bubble[]>([])
const scroller = ref<HTMLElement | null>(null)

const emit = defineEmits<{
  select: [agent: AgentSummary | null]
}>()

async function loadAgents() {
  loadError.value = ''
  try {
    const data = await fetchAgents()
    agents.value = data.agents
    if (!selected.value && data.agents[0]) {
      selected.value = data.agents[0].name
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
  bubbles.value = []
})

async function send() {
  const text = input.value.trim()
  const name = selected.value
  if (!text || !name || busy.value) return

  bubbles.value.push({ kind: 'user', text })
  input.value = ''
  busy.value = true
  await scrollBottom()

  try {
    const res = await chatWithAgent(name, text)
    for (const event of res.events) {
      if (event.type === 'message') {
        bubbles.value.push({ kind: 'agent', text: event.content })
      } else {
        bubbles.value.push({ kind: 'event', event })
      }
    }
    if (!res.events.some((e) => e.type === 'message') && res.reply) {
      bubbles.value.push({ kind: 'agent', text: res.reply })
    }
  } catch (err) {
    bubbles.value.push({
      kind: 'error',
      text: err instanceof Error ? err.message : String(err),
    })
  } finally {
    busy.value = false
    await scrollBottom()
  }
}

async function scrollBottom() {
  await nextTick()
  if (scroller.value) {
    scroller.value.scrollTop = scroller.value.scrollHeight
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

onMounted(() => {
  void loadAgents()
})
</script>

<template>
  <section class="chat">
    <header class="head">
      <div class="pick">
        <label for="agent">Agent</label>
        <select id="agent" v-model="selected" :disabled="!agents.length">
          <option v-if="!agents.length" value="">No agents</option>
          <option v-for="a in agents" :key="a.name" :value="a.name">
            {{ a.name }}
          </option>
        </select>
      </div>
      <button type="button" class="btn ghost small" @click="loadAgents">Reload</button>
    </header>

    <p v-if="loadError" class="banner">{{ loadError }}</p>

    <div ref="scroller" class="thread" role="log" aria-live="polite">
      <p v-if="!bubbles.length" class="empty">
        Ask about balances — e.g. “What’s my ETH balance?”
      </p>

      <template v-for="(b, i) in bubbles" :key="i">
        <div v-if="b.kind === 'user'" class="bubble user">{{ b.text }}</div>
        <div v-else-if="b.kind === 'agent'" class="bubble agent">{{ b.text }}</div>
        <div v-else-if="b.kind === 'error'" class="bubble error">{{ b.text }}</div>
        <div v-else class="event mono">
          <template v-if="b.event.type === 'tool_call'">
            → {{ b.event.name }} {{ JSON.stringify(b.event.args) }}
          </template>
          <template v-else-if="b.event.type === 'tool_result'">
            ← {{ b.event.content }}
          </template>
        </div>
      </template>

      <div v-if="busy" class="typing">Agent thinking…</div>
    </div>

    <form class="composer" @submit.prevent="send">
      <textarea
        v-model="input"
        rows="2"
        placeholder="Message the agent…"
        :disabled="busy || !selected"
        @keydown="onKey"
      />
      <button class="btn primary" type="submit" :disabled="busy || !input.trim() || !selected">
        Send
      </button>
    </form>
  </section>
</template>

<style scoped>
.chat {
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
  align-items: end;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid var(--border);
}

.pick {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1;
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

.banner {
  margin: 0;
  padding: 0.65rem 1rem;
  background: color-mix(in oklab, var(--warn) 12%, var(--surface));
  color: var(--warn);
  font-size: 0.82rem;
  border-bottom: 1px solid var(--border);
}

.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  background:
    radial-gradient(ellipse at top left, color-mix(in oklab, var(--accent) 8%, transparent), transparent 50%),
    var(--bg);
}

.empty {
  margin: auto;
  max-width: 22rem;
  text-align: center;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.bubble {
  max-width: min(36rem, 92%);
  padding: 0.7rem 0.85rem;
  border-radius: 0.55rem;
  font-size: 0.92rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble.user {
  align-self: flex-end;
  background: var(--accent);
  color: #041018;
}

.bubble.agent {
  align-self: flex-start;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.bubble.error {
  align-self: stretch;
  background: color-mix(in oklab, #c44 14%, var(--surface));
  color: #ffb4b0;
  border: 1px solid color-mix(in oklab, #c44 40%, var(--border));
}

.event {
  align-self: stretch;
  font-size: 0.72rem;
  color: var(--muted);
  padding: 0.25rem 0.4rem;
  opacity: 0.9;
}

.typing {
  font-size: 0.8rem;
  color: var(--muted);
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

.composer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.65rem;
  padding: 0.85rem;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.composer textarea {
  font: inherit;
  resize: none;
  padding: 0.65rem 0.75rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
  min-height: 2.75rem;
}

.composer textarea:focus {
  outline: 2px solid color-mix(in oklab, var(--accent) 45%, transparent);
  outline-offset: 1px;
}

.btn.small {
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
}

@media (max-width: 640px) {
  .composer {
    grid-template-columns: 1fr;
  }
}
</style>
