import type { DataStore } from "../store";
import type { AgentEvent, Files, MessagePart, Mode } from "../types";
import type { Agent, AgentTools } from "./types";

export const MAX_FILES = 60;
export const MAX_BYTES = 1_000_000;
const DEFAULT_TITLE = "Novo app";

const validPath = (p: string) => /^[\w.-]+(\/[\w.-]+)*$/.test(p) && !p.split("/").includes("..");

interface RunInput {
  store: DataStore;
  agent: Agent;
  userId: string;
  jobId: string;
  clientId: string;
  mode: Mode;
  text: string;
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

/**
 * One turn of the conversation: saves the user's message, lets the agent work
 * on a copy of the files, and saves a new version only if the turn succeeded.
 */
export async function runAgent({ store, agent, userId, jobId, clientId, mode, text, emit, signal }: RunInput) {
  const job = await store.getJob(userId, jobId);
  if (!job) return emit({ type: "error", message: "App não encontrado." });

  const history = await store.listMessages(jobId);
  if (history.some((m) => m.clientId === clientId)) {
    return emit({ type: "error", message: "Esta mensagem já foi enviada." });
  }
  if (!(await store.claimJob(jobId))) {
    return emit({ type: "error", message: "O agente ainda está trabalhando neste app. Espere ele terminar." });
  }

  const userMessage = await store.addMessage(jobId, {
    clientId,
    role: "user",
    mode,
    parts: [{ type: "text", text }],
  });

  const original = await store.getCurrentFiles(jobId);
  const files: Files = { ...original };
  const parts: MessagePart[] = [];
  let changed = false;
  let title: string | null = null;

  const record = (path: string, action: "created" | "edited" | "deleted") => {
    changed = true;
    parts.push({ type: "file", action, path });
    emit({ type: "file", action, path });
  };
  const checkLimits = () => {
    const bytes = Object.values(files).reduce((n, c) => n + c.length, 0);
    if (Object.keys(files).length > MAX_FILES || bytes > MAX_BYTES) {
      throw new Error(`O app passou do limite de ${MAX_FILES} arquivos ou ${MAX_BYTES / 1_000_000} MB.`);
    }
  };

  const tools: AgentTools = {
    listFiles: () => Object.keys(files).sort(),
    readFile: (path) => files[path],
    writeFile(path, content) {
      if (!validPath(path)) throw new Error(`Caminho inválido: ${path}`);
      const action = path in files ? "edited" : "created";
      files[path] = content;
      checkLimits();
      record(path, action);
    },
    editFile(path, oldText, newText) {
      const current = files[path];
      if (current === undefined) throw new Error(`Arquivo não existe: ${path}`);
      if (!current.includes(oldText)) throw new Error(`Trecho não encontrado em ${path}`);
      files[path] = current.replace(oldText, newText);
      checkLimits();
      record(path, "edited");
    },
    deleteFile(path) {
      if (!(path in files)) return;
      delete files[path];
      record(path, "deleted");
    },
    say(chunk) {
      const last = parts.at(-1);
      if (last?.type === "text") last.text += chunk;
      else parts.push({ type: "text", text: chunk });
      emit({ type: "text", text: chunk });
    },
    setTitle(t) {
      title = t.slice(0, 120);
    },
  };

  let status: "idle" | "error" = "idle";
  try {
    await agent.run({ mode, appType: job.appType, text, history, signal }, tools);
    if (changed && mode === "build") {
      const version = await store.addVersion(jobId, userMessage.id, files);
      emit({ type: "version", versionId: version.id, number: version.number });
    }
    if (title && job.title === DEFAULT_TITLE) await store.updateJob(userId, jobId, { title });
  } catch (err) {
    console.error("agent run failed", jobId, err);
    status = "error";
    const message = "A última etapa falhou e o app não foi alterado.";
    // The file changes were discarded, so the saved reply must not list them.
    const kept = parts.filter((p) => p.type !== "file");
    parts.splice(0, parts.length, ...kept, { type: "error", text: message });
    emit({ type: "error", message });
  } finally {
    const reply = await store.addMessage(jobId, {
      clientId: `${clientId}:reply`,
      role: "assistant",
      mode,
      parts,
    });
    await store.releaseJob(jobId, status);
    emit({ type: "done", messageId: reply.id });
  }
}
