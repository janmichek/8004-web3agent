/**
 * HTTP API for the Vue frontend: list agents and chat.
 *
 * Usage:
 *   npm run serve
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import dotenv from "dotenv";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { getLLM } from "../core/llm.js";
import {
  AGENTS_DIR,
  fundAgentWallet,
  getMasterWalletBalance,
  getMasterWallet,
  getOrCreateAgentWallet,
} from "../core/wallet.js";
import { discoverAgentSkills, resolveAgentSkills } from "../core/agent-skills.js";
import { createFileCheckpointer } from "../core/file-checkpoint.js";
import {
  loadAgentConfig,
  resolveToolsFromConfig,
  buildCapabilitySummary,
} from "../core/agent-config.js";
import { ethers } from "ethers";
import { getNetworkNameByChainId, getNetworkConfig, getRpcUrl } from "../core/config.js";
import type { Skill } from "../actions/types.js";

dotenv.config();

const PORT = Number(process.env.API_PORT || 8787);

type ChatEvent =
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; content: string }
  | { type: "message"; content: string };

function agentEnvSuffix(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function listEnvAgents(): string[] {
  const agents = new Set<string>();
  for (const key of Object.keys(process.env)) {
    // AGENT_<SUFFIX>_CONFIG or AGENT_<SUFFIX>_PRIVATE_KEY
    const m = key.match(/^AGENT_(.+)_CONFIG$/) || key.match(/^AGENT_(.+)_PRIVATE_KEY$/);
    if (m) {
      const suffix = m[1];
      // reverse to original name is ambiguous, so we store mapping via config name field
      // Instead, derive from config JSON's name or brute-force by checking all env suffixes against known pattern
      // For now, extract name from config JSON if available
      const raw = process.env[key];
      if (raw && key.endsWith("_CONFIG")) {
        try {
          const parsed = JSON.parse(raw) as { name?: string };
          if (parsed.name) agents.add(parsed.name);
          else agents.add(suffix.toLowerCase().replace(/_/g, "-"));
        } catch {
          agents.add(suffix.toLowerCase().replace(/_/g, "-"));
        }
      } else if (raw) {
        // private key only — try to find matching config env, otherwise use suffix as name
        const configKey = `AGENT_${suffix}_CONFIG`;
        const configRaw = process.env[configKey];
        if (configRaw) {
          try {
            const parsed = JSON.parse(configRaw) as { name?: string };
            if (parsed.name) agents.add(parsed.name);
          } catch { /* ignore */ }
        }
        // fallback: if we haven't added yet, use suffix lowercased
        if (!agents.has(suffix.toLowerCase().replace(/_/g, "-"))) {
          // Only add if not already covered by config
          const hasConfig = [...agents].some((a) => agentEnvSuffix(a) === suffix);
          if (!hasConfig) agents.add(suffix.toLowerCase().replace(/_/g, "-"));
        }
      }
    }
  }
  return [...agents];
}

function listExistingAgents(): string[] {
  const fromFs = new Set<string>();
  const dirsToScan = [AGENTS_DIR];
  if (process.env.VERCEL) dirsToScan.push(path.resolve(process.cwd(), "agents"));
  for (const dir of dirsToScan) {
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      // On Vercel, existence of wallet via env is enough; on FS check wallet.json
      const walletPath = path.join(dir, e.name, "wallet.json");
      const envPk = process.env[`AGENT_${agentEnvSuffix(e.name)}_PRIVATE_KEY`];
      if (fs.existsSync(walletPath) || envPk) fromFs.add(e.name);
    }
  }
  // Merge env agents
  for (const n of listEnvAgents()) fromFs.add(n);
  return [...fromFs];
}

function publicAgentSummary(name: string) {
  const config = loadAgentConfig(name);
  let walletAddress: string | undefined = config?.walletAddress;
  // Try env private key first
  if (!walletAddress) {
    const envPk = process.env[`AGENT_${agentEnvSuffix(name)}_PRIVATE_KEY`];
    if (envPk) {
      try { walletAddress = new ethers.Wallet(envPk).address; } catch { /* ignore */ }
    }
  }
  if (!walletAddress) {
    const candidates = [path.join(AGENTS_DIR, name, "wallet.json")];
    if (process.env.VERCEL) candidates.push(path.join(path.resolve(process.cwd(), "agents"), name, "wallet.json"));
    for (const walletPath of candidates) {
      if (!fs.existsSync(walletPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8")) as { address?: string };
        walletAddress = raw.address;
        break;
      } catch { /* ignore */ }
    }
  }

  return {
    name,
    description: config?.description ?? `Agent ${name}`,
    walletAddress,
    walletChainId: config?.walletChainId ?? getNetworkConfig().chainId,
    agentId: config?.agentId,
    agentURI: config?.agentURI,
    actions: config?.metadata?.actions ?? [],
    tools: config?.metadata?.tools ?? [],
    active: config?.active ?? true,
  };
}

async function runChat(agentName: string, message: string): Promise<{
  reply: string;
  events: ChatEvent[];
}> {
  const wallet = getOrCreateAgentWallet({ agentName });
  process.env.AGENT_PRIVATE_KEY = wallet.privateKey;

  const agentConfig = loadAgentConfig(agentName);
  let tools: Awaited<ReturnType<typeof resolveAgentSkills>>;
  let skills: Skill[] = [];

  if (agentConfig) {
    const resolved = resolveToolsFromConfig(agentConfig);
    tools = resolved.tools;
    skills = resolved.skills;
  } else {
    tools = await resolveAgentSkills(agentName, wallet.privateKey);
  }

  const { saver, flush } = createFileCheckpointer(agentName);

  const networkName = agentConfig?.walletChainId
    ? getNetworkNameByChainId(agentConfig.walletChainId)
    : getNetworkConfig().name;

  const skillContext = skills.map((s) => `## Skill: ${s.name}\n\n${s.context}`).join("\n\n");
  const capabilitySummary = agentConfig
    ? buildCapabilitySummary(agentConfig)
    : "No capabilities configured.";
  const systemMessage = [
    `You are "${agentName}", an onchain AI agent on ${networkName}.`,
    `Your wallet address is: ${wallet.address}`,
    agentConfig?.walletChainId ? `Chain ID: ${agentConfig.walletChainId}` : "",
    agentConfig?.agentId ? `ERC-8004 Agent ID: ${agentConfig.agentId}` : "",
    "",
    `## Your Capabilities\n\n${capabilitySummary}`,
    skillContext,
  ]
    .filter(Boolean)
    .join("\n");

  const llm = getLLM();
  const agent = createReactAgent({
    llm,
    tools,
    checkpointSaver: saver,
    prompt: systemMessage,
  });

  const events: ChatEvent[] = [];
  let reply = "";

  const stream = await agent.stream(
    { messages: [{ role: "user", content: message }] },
    { configurable: { thread_id: agentName }, recursionLimit: 8, streamMode: "updates" },
  );

  for await (const update of stream) {
    for (const output of Object.values(update)) {
      const messages = (output as { messages?: unknown[] })?.messages ?? [];
      for (const msg of messages) {
        const m = msg as {
          _getType?: () => string;
          content?: unknown;
          tool_calls?: { name: string; args: unknown }[];
        };
        const role = m._getType?.() ?? "unknown";
        const content =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");

        if (role === "ai") {
          const calls = m.tool_calls ?? [];
          for (const tc of calls) {
            events.push({ type: "tool_call", name: tc.name, args: tc.args });
          }
          if (content.trim()) {
            events.push({ type: "message", content: content.trim() });
            reply = content.trim();
          }
        } else if (role === "tool") {
          events.push({ type: "tool_result", content: content.slice(0, 2000) });
        }
      }
    }
  }

  flush();
  return { reply: reply || "(no response)", events };
}

export const app = new Hono();

const isVercel = !!process.env.VERCEL;

app.use(
  "*",
  cors({
    origin: isVercel ? "*" : ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/api/health", async (c) => {
  let master: { address?: string; balanceEth?: string } = {};
  try {
    const wallet = getMasterWallet();
    master = {
      address: wallet.address,
      balanceEth: await getMasterWalletBalance(),
    };
  } catch {
    /* master key optional for health */
  }
  return c.json({
    ok: true,
    network: getNetworkConfig().name,
    chainId: getNetworkConfig().chainId,
    master,
  });
});

/** Proxy JSON-RPC to the configured RPC_URL (avoids public/Alchemy browser rate limits). */
app.post("/api/rpc", async (c) => {
  let rpcUrl: string;
  try {
    rpcUrl = getRpcUrl();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: msg } }, 500);
  }

  const body = await c.req.text();
  try {
    const upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: msg } }, 502);
  }
});

app.get("/api/agents", (c) => {
  const agents = listExistingAgents().map(publicAgentSummary);
  return c.json({ agents });
});

app.get("/api/agents/:name", (c) => {
  const name = c.req.param("name");
  if (!listExistingAgents().includes(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }
  return c.json({ agent: publicAgentSummary(name) });
});

app.post("/api/agents/:name/fund", async (c) => {
  const name = c.req.param("name");
  if (!listExistingAgents().includes(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const summary = publicAgentSummary(name);
  if (!summary.walletAddress) {
    return c.json({ error: "Agent has no wallet address" }, 400);
  }

  let body: { amountEth?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const amountEth = body.amountEth?.trim() || "0.001";
  const amount = Number(amountEth);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1) {
    return c.json({ error: "amountEth must be a number between 0 and 1" }, 400);
  }

  try {
    const txHash = await fundAgentWallet({
      agentAddress: summary.walletAddress,
      amountEth,
    });
    return c.json({
      ok: true,
      txHash,
      amountEth,
      to: summary.walletAddress,
      from: getMasterWallet().address,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/agents/:name/chat", async (c) => {
  const name = c.req.param("name");
  if (!listExistingAgents().includes(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  let body: { message?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const message = body.message?.trim();
  if (!message) {
    return c.json({ error: "message is required" }, 400);
  }

  try {
    const result = await runChat(name, message);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

if (!process.env.VERCEL) {
  console.log(`web3agent API listening on http://localhost:${PORT}`);
  serve({ fetch: app.fetch, port: PORT });
}

export default app;
