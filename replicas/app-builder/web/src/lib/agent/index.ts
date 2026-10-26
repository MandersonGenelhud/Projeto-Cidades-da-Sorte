import { MockAgent } from "./mock-agent";
import type { Agent } from "./types";

/** The agent for this server. The Claude agent replaces the mock once it is built and a key is set. */
export function getAgent(): Agent {
  const delay = process.env.MOCK_AGENT_DELAY_MS;
  return new MockAgent({ delayMs: delay === undefined ? 300 : Number(delay) });
}
