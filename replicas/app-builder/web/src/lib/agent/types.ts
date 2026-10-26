import type { AppType, Files, Message, Mode } from "../types";

export interface AgentContext {
  mode: Mode;
  appType: AppType;
  /** The new user message. */
  text: string;
  /** Earlier messages in this job, oldest first. */
  history: Message[];
  signal?: AbortSignal;
}

/** What an agent may do. Every call is streamed to the browser. */
export interface AgentTools {
  listFiles(): string[];
  readFile(path: string): string | undefined;
  writeFile(path: string, content: string): void;
  editFile(path: string, oldText: string, newText: string): void;
  deleteFile(path: string): void;
  say(text: string): void;
  /** Proposes a better name for the job (used on the first build). */
  setTitle(title: string): void;
}

export interface Agent {
  run(ctx: AgentContext, tools: AgentTools): Promise<void>;
}

export type { Files };
