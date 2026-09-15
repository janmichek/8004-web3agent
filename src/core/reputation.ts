/**
 * ERC-8004 Reputation Registry integration (feedback / ratings).
 * @module reputation
 */

import { SDK } from "@blockbyvlog/agent0-sdk";
import { getActiveNetwork, getNetworkConfig, getRpcUrl } from "./config.js";

export interface GiveFeedbackOptions {
  agentId: string;
  value: number;
  tag?: string;
  endpoint?: string;
  comment?: string;
  /** Defaults to RATER_PRIVATE_KEY env when omitted. */
  privateKey?: string;
}

export interface GiveFeedbackResult {
  txHash: string;
  agentId: string;
  value: number;
}

export interface ReputationSummary {
  count: number;
  averageValue: number;
}

function buildSdk(privateKey: string): SDK {
  const network = getActiveNetwork();
  const config = getNetworkConfig(network);
  return new SDK({ chainId: config.chainId, rpcUrl: getRpcUrl(), privateKey });
}

/** Clamp rating to ERC-8004 0-100 range. */
export function normalizeRating(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid rating "${value}": must be a number 0-100`);
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Resolve the dedicated rater key (preferred) or fall back to AGENT_PRIVATE_KEY. */
export function resolveRaterPrivateKey(override?: string): string {
  const key = override || process.env.RATER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
  if (!key) {
    throw new Error("RATER_PRIVATE_KEY is not set (needed to sign feedback without self-rating)");
  }
  return key;
}

export async function giveFeedback(options: GiveFeedbackOptions): Promise<GiveFeedbackResult> {
  const { agentId, tag, endpoint, comment } = options;
  const privateKey = resolveRaterPrivateKey(options.privateKey);
  const value = normalizeRating(options.value);
  if (!agentId) throw new Error("agentId is required");

  const sdk = buildSdk(privateKey);
  // Off-chain feedback files need Pinata/IPFS; skip when not configured so ratings still land on-chain.
  const hasIpfs = Boolean(process.env.PINATA_JWT || process.env.IPFS_NODE_URL);
  const feedbackFile =
    comment && hasIpfs ? sdk.prepareFeedbackFile({ comment } as never) : undefined;
  // If we cannot store the comment off-chain, fold a short note into tag2 via the tag field only.
  const tag1 = tag || (comment && !hasIpfs ? comment.slice(0, 32) : undefined);
  const handle = await sdk.giveFeedback(
    agentId as never,
    value,
    tag1,
    undefined,
    endpoint,
    feedbackFile as never,
  );
  await handle.waitMined();
  const txHash = (handle as { hash?: string }).hash ?? "unknown";
  console.log(`[reputation] Feedback ${value}/100 -> ${agentId} tx=${txHash}`);
  return { txHash: String(txHash), agentId, value };
}

export async function getReputationSummary(agentId: string, tag?: string): Promise<ReputationSummary> {
  const rpcUrl = (() => { try { return getRpcUrl(); } catch { return undefined; } })();
  const network = getActiveNetwork();
  const config = getNetworkConfig(network);
  // Read-only SDK: omit privateKey when no signer available.
  const sdk = new SDK({
    chainId: config.chainId,
    rpcUrl: rpcUrl ?? config.defaultRpcUrl,
    ...(process.env.AGENT_PRIVATE_KEY ? { privateKey: process.env.AGENT_PRIVATE_KEY } : {}),
  });
  return sdk.getReputationSummary(agentId as never, tag);
}
