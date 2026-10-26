import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileStore } from "../store/file-store";
import type { AgentEvent } from "../types";
import { cityFromPrompt, MockAgent } from "./mock-agent";
import { runAgent } from "./runner";
import type { Agent } from "./types";

let dir: string;
let store: FileStore;
const mock = new MockAgent({ delayMs: 0 });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agent-"));
  store = new FileStore(path.join(dir, "db.json"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function send(jobId: string, text: string, opts: { mode?: "build" | "plan"; clientId?: string; agent?: Agent } = {}) {
  const events: AgentEvent[] = [];
  await runAgent({
    store,
    agent: opts.agent ?? mock,
    userId: "u1",
    jobId,
    clientId: opts.clientId ?? crypto.randomUUID(),
    mode: opts.mode ?? "build",
    text,
    emit: (e) => events.push(e),
  });
  return events;
}

describe("cityFromPrompt", () => {
  it.each([
    ["Cria um site de sorteio para Campinas com cadastro", "Campinas"],
    ["sorteio em são josé dos campos", "São José Dos Campos"],
    ["site de sorteio de Ribeirão Preto", "Ribeirão Preto"],
    ["um site de sorteio", null],
  ])("%s", (prompt, city) => {
    expect(cityFromPrompt(prompt)).toBe(city);
  });
});

describe("runAgent with the mock agent", () => {
  it("builds a raffle site, saves a version and streams each file", async () => {
    const job = await store.createJob("u1", { title: "Novo app", appType: "raffle" });
    const events = await send(job.id, "site de sorteio para Campinas");

    expect(events.filter((e) => e.type === "file").map((e) => e.type === "file" && e.path)).toEqual([
      "index.html",
      "styles.css",
      "app.js",
    ]);
    expect(events.at(-1)?.type).toBe("done");
    const files = await store.getCurrentFiles(job.id);
    expect(files["index.html"]).toContain("Campinas");
    const after = await store.getJob("u1", job.id);
    expect(after?.status).toBe("idle");
    expect(after?.title).toBe("Sorteio Campinas");
    const messages = await store.listMessages(job.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("plans without writing files", async () => {
    const job = await store.createJob("u1", { title: "Novo app", appType: "raffle" });
    const events = await send(job.id, "sorteio para Campinas", { mode: "plan" });
    expect(events.some((e) => e.type === "file")).toBe(false);
    expect(await store.getCurrentFiles(job.id)).toEqual({});
  });

  it("applies a colour change on a follow-up message", async () => {
    const job = await store.createJob("u1", { title: "Novo app", appType: "raffle" });
    await send(job.id, "sorteio para Campinas");
    const events = await send(job.id, "deixa o botão verde");
    expect(events).toContainEqual({ type: "file", action: "edited", path: "styles.css" });
    expect((await store.getCurrentFiles(job.id))["styles.css"]).toContain("--primary: #15803d");
  });

  it("refuses a second run while one is working", async () => {
    const job = await store.createJob("u1", { title: "Novo app", appType: "raffle" });
    await store.claimJob(job.id);
    const events = await send(job.id, "sorteio para Campinas");
    expect(events).toEqual([{ type: "error", message: "O agente ainda está trabalhando neste app. Espere ele terminar." }]);
  });

  it("records a failure without changing the files", async () => {
    const job = await store.createJob("u1", { title: "Novo app", appType: "raffle" });
    await send(job.id, "sorteio para Campinas");
    const before = await store.getCurrentFiles(job.id);
    const broken: Agent = {
      async run(_ctx, tools) {
        tools.writeFile("index.html", "quebrado");
        throw new Error("boom");
      },
    };
    const events = await send(job.id, "muda tudo", { agent: broken });
    expect(events.at(-2)).toEqual({ type: "error", message: "A última etapa falhou e o app não foi alterado." });
    expect(await store.getCurrentFiles(job.id)).toEqual(before);
    expect((await store.getJob("u1", job.id))?.status).toBe("error");
  });

  it("returns nothing new for a repeated client id", async () => {
    const job = await store.createJob("u1", { title: "Novo app", appType: "raffle" });
    await send(job.id, "sorteio para Campinas", { clientId: "same" });
    const again = await send(job.id, "sorteio para Campinas", { clientId: "same" });
    expect(again).toEqual([{ type: "error", message: "Esta mensagem já foi enviada." }]);
    expect(await store.listMessages(job.id)).toHaveLength(2);
  });
});
