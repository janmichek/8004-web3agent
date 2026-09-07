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
import { getNetworkNameByChainId, getNetworkConfig, getRpcUrl } from "../core/config.js";
import type { Skill } from "../actions/types.js";

dotenv.config();

const PORT = Number(process.env.API_PORT || 8787);

type ChatEvent =
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; content: string }
  | { type: "message"; content: string };

function listExistingAgents(): string[] {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs
    .readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(AGENTS_DIR, e.name, "wallet.json")))
    .map((e) => e.name);
}

function publicAgentSummary(name: string) {
  const config = loadAgentConfig(name);
  const walletPath = path.join(AGENTS_DIR, name, "wallet.json");
  let walletAddress: string | undefined = config?.walletAddress;
  if (!walletAddress && fs.existsSync(walletPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8")) as { address?: string };
      walletAddress = raw.address;
    } catch {
      /* ignore */
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

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
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

console.log(`web3agent API listening on http://localhost:${PORT}`);
serve({ fetch: app.fetch, port: PORT });
