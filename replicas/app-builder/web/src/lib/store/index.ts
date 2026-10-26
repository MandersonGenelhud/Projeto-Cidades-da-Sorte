import path from "node:path";
import type { AppType, Files, FileVersion, Job, JobStatus, Message } from "../types";
import { FileStore } from "./file-store";

export type NewMessage = Pick<Message, "clientId" | "role" | "mode" | "parts">;

/**
 * The data layer. FileStore keeps everything in a local JSON file for
 * development; a Supabase implementation with the same methods replaces it
 * later without touching any screen or route.
 */
export interface DataStore {
  listJobs(userId: string): Promise<Job[]>;
  getJob(userId: string, jobId: string): Promise<Job | null>;
  createJob(userId: string, input: { title: string; appType: AppType }): Promise<Job>;
  updateJob(userId: string, jobId: string, patch: { title?: string }): Promise<Job | null>;
  deleteJob(userId: string, jobId: string): Promise<boolean>;
  /** Marks the job as working; false when another run already holds it. */
  claimJob(jobId: string): Promise<boolean>;
  releaseJob(jobId: string, status: JobStatus): Promise<void>;
  listMessages(jobId: string): Promise<Message[]>;
  addMessage(jobId: string, message: NewMessage): Promise<Message>;
  addVersion(jobId: string, messageId: string | null, files: Files): Promise<FileVersion>;
  getCurrentFiles(jobId: string): Promise<Files>;
}

// Shared across route modules, which Next.js may load as separate instances.
const globalStore = globalThis as typeof globalThis & { __appBuilderStore?: DataStore };

export function getStore(): DataStore {
  globalStore.__appBuilderStore ??= new FileStore(
    process.env.DATA_FILE ?? path.join(process.cwd(), ".data", "db.json"),
  );
  return globalStore.__appBuilderStore;
}
