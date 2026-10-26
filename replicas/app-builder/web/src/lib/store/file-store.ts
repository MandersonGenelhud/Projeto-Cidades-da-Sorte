import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AppType, Files, FileVersion, Job, JobStatus, Message } from "../types";
import type { DataStore, NewMessage } from "./index";

interface Db {
  jobs: Job[];
  messages: Message[];
  versions: FileVersion[];
}

const now = () => new Date().toISOString();
/** A run that has not touched its job for this long is treated as dead. */
export const STALE_LOCK_MS = 5 * 60_000;

/** Development store: one JSON file, every write serialized through a queue. */
export class FileStore implements DataStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  private load(): Db {
    if (!existsSync(this.file)) return { jobs: [], messages: [], versions: [] };
    return JSON.parse(readFileSync(this.file, "utf8")) as Db;
  }

  private save(db: Db) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, this.file);
  }

  private read<T>(fn: (db: Db) => T): Promise<T> {
    return this.write(fn, false);
  }

  private write<T>(fn: (db: Db) => T, persist = true): Promise<T> {
    const run = this.queue.then(() => {
      const db = this.load();
      const result = fn(db);
      if (persist) this.save(db);
      return structuredClone(result);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  listJobs(userId: string) {
    return this.read((db) =>
      db.jobs.filter((j) => j.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  getJob(userId: string, jobId: string) {
    return this.read((db) => db.jobs.find((j) => j.id === jobId && j.userId === userId) ?? null);
  }

  createJob(userId: string, input: { title: string; appType: AppType }) {
    return this.write((db) => {
      const t = now();
      const job: Job = {
        id: randomUUID(),
        userId,
        title: input.title,
        appType: input.appType,
        status: "idle",
        currentVersionId: null,
        createdAt: t,
        updatedAt: t,
      };
      db.jobs.push(job);
      return job;
    });
  }

  updateJob(userId: string, jobId: string, patch: { title?: string }) {
    return this.write((db) => {
      const job = db.jobs.find((j) => j.id === jobId && j.userId === userId);
      if (!job) return null;
      if (patch.title !== undefined) job.title = patch.title;
      job.updatedAt = now();
      return job;
    });
  }

  deleteJob(userId: string, jobId: string) {
    return this.write((db) => {
      const before = db.jobs.length;
      db.jobs = db.jobs.filter((j) => !(j.id === jobId && j.userId === userId));
      if (db.jobs.length === before) return false;
      db.messages = db.messages.filter((m) => m.jobId !== jobId);
      db.versions = db.versions.filter((v) => v.jobId !== jobId);
      return true;
    });
  }

  claimJob(jobId: string) {
    return this.write((db) => {
      const job = db.jobs.find((j) => j.id === jobId);
      if (!job) return false;
      const fresh = Date.now() - Date.parse(job.updatedAt) < STALE_LOCK_MS;
      if (job.status === "working" && fresh) return false;
      job.status = "working";
      job.updatedAt = now();
      return true;
    });
  }

  releaseJob(jobId: string, status: JobStatus) {
    return this.write((db) => {
      const job = db.jobs.find((j) => j.id === jobId);
      if (job) {
        job.status = status;
        job.updatedAt = now();
      }
    });
  }

  listMessages(jobId: string) {
    return this.read((db) => db.messages.filter((m) => m.jobId === jobId));
  }

  addMessage(jobId: string, input: NewMessage) {
    return this.write((db) => {
      const existing = db.messages.find((m) => m.jobId === jobId && m.clientId === input.clientId);
      if (existing) return existing;
      const message: Message = { id: randomUUID(), jobId, createdAt: now(), ...input };
      db.messages.push(message);
      return message;
    });
  }

  addVersion(jobId: string, messageId: string | null, files: Files) {
    return this.write((db) => {
      const number = db.versions.filter((v) => v.jobId === jobId).length + 1;
      const version: FileVersion = { id: randomUUID(), jobId, messageId, number, files, createdAt: now() };
      db.versions.push(version);
      const job = db.jobs.find((j) => j.id === jobId);
      if (job) {
        job.currentVersionId = version.id;
        job.updatedAt = now();
      }
      return version;
    });
  }

  getCurrentFiles(jobId: string) {
    return this.read((db) => {
      const job = db.jobs.find((j) => j.id === jobId);
      return db.versions.find((v) => v.id === job?.currentVersionId)?.files ?? {};
    });
  }
}
