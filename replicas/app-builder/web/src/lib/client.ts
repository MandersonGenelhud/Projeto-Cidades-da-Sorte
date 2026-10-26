"use client";

import type { AgentEvent, AppType, Files, Job, Message, Mode } from "./types";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erro ${res.status}`);
  return body as T;
}

export const api = {
  listJobs: () => fetch("/api/jobs", { cache: "no-store" }).then((r) => json<{ jobs: Job[] }>(r)),
  createJob: (appType: AppType) =>
    fetch("/api/jobs", { method: "POST", body: JSON.stringify({ appType }) }).then((r) => json<{ job: Job }>(r)),
  getJob: (id: string) =>
    fetch(`/api/jobs/${id}`, { cache: "no-store" }).then((r) =>
      json<{ job: Job; messages: Message[]; files: Files }>(r),
    ),
  renameJob: (id: string, title: string) =>
    fetch(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }).then((r) => json<{ job: Job }>(r)),
  deleteJob: async (id: string) => {
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`Erro ${res.status}`);
  },
};

/** Sends a message and calls onEvent for every server-sent event until the turn ends. */
export async function sendMessage(
  jobId: string,
  body: { text: string; mode: Mode; clientId: string },
  onEvent: (event: AgentEvent) => void,
) {
  const res = await fetch(`/api/jobs/${jobId}/messages`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    onEvent({ type: "error", message: err.error ?? "Não foi possível falar com o servidor." });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      if (chunk.startsWith("data: ")) onEvent(JSON.parse(chunk.slice(6)) as AgentEvent);
    }
  }
}

/** Lets the sidebar know the job list changed. */
export const JOBS_CHANGED = "app-builder:jobs-changed";
export const notifyJobsChanged = () => window.dispatchEvent(new Event(JOBS_CHANGED));

/** First message typed on the home screen, handed to the workspace after navigation. */
export const pendingFirstMessage = new Map<string, { text: string; mode: Mode; clientId: string }>();

export function relativeTime(iso: string, now = Date.now()) {
  const diff = (Date.parse(iso) - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [Infinity, "week"],
  ];
  if (Math.abs(diff) < 45) return "agora";
  let unit = 1;
  for (const [limit, name] of steps) {
    if (Math.abs(diff) < limit) return rtf.format(Math.round(diff / unit), name);
    unit = limit;
  }
  return "";
}
