export type AppType = "web" | "landing" | "raffle" | "brainstorm";
export type Mode = "build" | "plan";
export type JobStatus = "idle" | "working" | "error";

export type Files = Record<string, string>;

export interface Job {
  id: string;
  userId: string;
  title: string;
  appType: AppType;
  status: JobStatus;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FileAction = "created" | "edited" | "deleted";

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "file"; action: FileAction; path: string }
  | { type: "error"; text: string };

export interface Message {
  id: string;
  jobId: string;
  clientId: string;
  role: "user" | "assistant";
  mode: Mode;
  parts: MessagePart[];
  createdAt: string;
}

export interface FileVersion {
  id: string;
  jobId: string;
  messageId: string | null;
  number: number;
  files: Files;
  createdAt: string;
}

/** Events streamed to the browser while the agent works. */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "file"; action: FileAction; path: string }
  | { type: "version"; versionId: string; number: number }
  | { type: "error"; message: string }
  | { type: "done"; messageId: string };
