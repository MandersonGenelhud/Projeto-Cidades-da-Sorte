import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileStore, STALE_LOCK_MS } from "./file-store";

let dir: string;
let store: FileStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "store-"));
  store = new FileStore(path.join(dir, "db.json"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("FileStore", () => {
  it("creates jobs and lists only the owner's, newest first", async () => {
    const a = await store.createJob("u1", { title: "A", appType: "web" });
    const b = await store.createJob("u1", { title: "B", appType: "raffle" });
    await store.createJob("u2", { title: "C", appType: "web" });
    const list = await store.listJobs("u1");
    expect(list.map((j) => j.id)).toEqual([b.id, a.id]);
    expect(await store.getJob("u2", a.id)).toBeNull();
  });

  it("ignores a duplicate message with the same client id", async () => {
    const job = await store.createJob("u1", { title: "A", appType: "web" });
    const first = await store.addMessage(job.id, { clientId: "c1", role: "user", mode: "build", parts: [{ type: "text", text: "oi" }] });
    const again = await store.addMessage(job.id, { clientId: "c1", role: "user", mode: "build", parts: [{ type: "text", text: "oi" }] });
    expect(again.id).toBe(first.id);
    expect(await store.listMessages(job.id)).toHaveLength(1);
  });

  it("numbers versions and moves the job's current version", async () => {
    const job = await store.createJob("u1", { title: "A", appType: "web" });
    const v1 = await store.addVersion(job.id, null, { "index.html": "1" });
    const v2 = await store.addVersion(job.id, null, { "index.html": "2" });
    expect([v1.number, v2.number]).toEqual([1, 2]);
    expect((await store.getJob("u1", job.id))?.currentVersionId).toBe(v2.id);
    expect((await store.getCurrentFiles(job.id))["index.html"]).toBe("2");
  });

  it("lets only one agent run claim a job at a time", async () => {
    const job = await store.createJob("u1", { title: "A", appType: "web" });
    expect(await store.claimJob(job.id)).toBe(true);
    expect(await store.claimJob(job.id)).toBe(false);
    await store.releaseJob(job.id, "idle");
    expect(await store.claimJob(job.id)).toBe(true);
  });

  it("takes over a lock left behind by a run that died", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const job = await store.createJob("u1", { title: "A", appType: "web" });
      expect(await store.claimJob(job.id)).toBe(true);
      vi.setSystemTime(Date.now() + STALE_LOCK_MS + 1);
      expect(await store.claimJob(job.id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renames and deletes jobs with their messages and versions", async () => {
    const job = await store.createJob("u1", { title: "A", appType: "web" });
    await store.addVersion(job.id, null, { "index.html": "x" });
    expect((await store.updateJob("u1", job.id, { title: "Novo" }))?.title).toBe("Novo");
    expect(await store.deleteJob("u1", job.id)).toBe(true);
    expect(await store.getJob("u1", job.id)).toBeNull();
    expect(await store.getCurrentFiles(job.id)).toEqual({});
  });

  it("persists to disk", async () => {
    const job = await store.createJob("u1", { title: "A", appType: "web" });
    const reopened = new FileStore(path.join(dir, "db.json"));
    expect((await reopened.getJob("u1", job.id))?.title).toBe("A");
  });
});
