export type AgentSummary = {
  name: string
  description: string
  walletAddress?: string
  walletChainId: number
  agentId?: string
  agentURI?: string
  actions: string[]
  tools: string[]
  active: boolean
}

export type ChatEvent =
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; content: string }
  | { type: 'message'; content: string }

export type ChatResponse = {
  reply: string
  events: ChatEvent[]
}

export type CatalogAction = {
  name: string
  description: string
  toolNames: string[]
  skillName: string
}

export type CatalogTool = {
  name: string
  description: string
}

export type CatalogResponse = {
  network: string
  networkName: string
  chainId: number
  master: { address?: string; balanceEth?: string }
  actions: CatalogAction[]
  tools: CatalogTool[]
}

export type CreateAgentRequest = {
  name: string
  actions?: string[]
  tools?: string[]
  fundEth?: string
  skipRegister?: boolean
}

export type CreateAgentStep = {
  step: string
  ok: boolean
  detail?: string
}

export type CreateAgentResponse = {
  ok: boolean
  agent: AgentSummary
  balanceEth: string
  fundTxHash?: string
  steps: CreateAgentStep[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data as T
}

export function fetchAgents() {
  return request<{ agents: AgentSummary[] }>('/api/agents')
}

export function fetchHealth() {
  return request<{ ok: boolean; network: string; chainId: number }>('/api/health')
}

export function fetchCatalog() {
  return request<CatalogResponse>('/api/catalog')
}

export function createAgent(body: CreateAgentRequest) {
  return request<CreateAgentResponse>('/api/agents', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function chatWithAgent(name: string, message: string) {
  return request<ChatResponse>(`/api/agents/${encodeURIComponent(name)}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}

export function fundAgent(name: string, amountEth: string) {
  return request<{
    ok: boolean
    txHash: string
    amountEth: string
    to: string
    from: string
  }>(`/api/agents/${encodeURIComponent(name)}/fund`, {
    method: 'POST',
    body: JSON.stringify({ amountEth }),
  })
}
