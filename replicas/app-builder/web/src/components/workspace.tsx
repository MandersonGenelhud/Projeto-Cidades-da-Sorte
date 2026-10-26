"use client";

import { ArrowUp, Check, ExternalLink, FileText, Globe, Pencil, RotateCw, Smartphone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, notifyJobsChanged, pendingFirstMessage, sendMessage } from "@/lib/client";
import { buildPreviewHtml } from "@/lib/preview";
import type { AgentEvent, Files, Job, Message, MessagePart, Mode } from "@/lib/types";
import { Button, ModeToggle, StatusBadge } from "./ui";

interface Live {
  user: Message;
  parts: MessagePart[];
}

export function Workspace({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<Files>({});
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [pane, setPane] = useState<"chat" | "app">("chat");

  const refresh = useCallback(
    () =>
      api.getJob(jobId).then(
        (data) => {
          setJob(data.job);
          setMessages(data.messages);
          setFiles(data.files);
          setLoadError(false);
          return data;
        },
        (err: unknown) => {
          if (err instanceof Error && err.message.includes("não encontrado")) setMissing(true);
          else setLoadError(true);
          return null;
        },
      ),
    [jobId],
  );

  const send = useCallback(
    async (text: string, mode: Mode, clientId: string = crypto.randomUUID()) => {
      const user: Message = {
        id: `local-${clientId}`,
        jobId,
        clientId,
        role: "user",
        mode,
        parts: [{ type: "text", text }],
        createdAt: new Date().toISOString(),
      };
      setLive({ user, parts: [] });
      setJob((j) => (j ? { ...j, status: "working" } : j));
      notifyJobsChanged();

      const onEvent = (event: AgentEvent) => {
        if (event.type === "version") {
          api.getJob(jobId).then((d) => setFiles(d.files)).catch(() => {});
          return;
        }
        if (event.type === "done") return;
        setLive((l) => {
          if (!l) return l;
          const parts = [...l.parts];
          const last = parts.at(-1);
          if (event.type === "text") {
            if (last?.type === "text") parts[parts.length - 1] = { ...last, text: last.text + event.text };
            else parts.push({ type: "text", text: event.text });
          } else if (event.type === "file") {
            parts.push({ type: "file", action: event.action, path: event.path });
          } else if (event.type === "error") {
            parts.push({ type: "error", text: event.message });
          }
          return { ...l, parts };
        });
      };

      try {
        await sendMessage(jobId, { text, mode, clientId }, onEvent);
      } catch {
        onEvent({ type: "error", message: "A conexão caiu. O agente pode ter continuado; recarregue para ver." });
      }
      const data = await refresh();
      // Keep the live copy only if the server did not save the turn (e.g. it refused it).
      if (data?.messages.some((m) => m.clientId === clientId)) setLive(null);
      else setJob((j) => (j && j.status === "working" ? { ...j, status: "idle" } : j));
      notifyJobsChanged();
    },
    [jobId, refresh],
  );

  useEffect(() => {
    let cancelled = false;
    refresh().then((data) => {
      if (cancelled || !data) return;
      const first = pendingFirstMessage.get(jobId);
      if (first) {
        pendingFirstMessage.delete(jobId);
        send(first.text, first.mode, first.clientId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, refresh, send]);

  // Another tab may be building this job: follow along until it finishes.
  const workingElsewhere = job?.status === "working" && !live;
  useEffect(() => {
    if (!workingElsewhere) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [workingElsewhere, refresh]);

  if (missing) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Este app não existe mais</h1>
          <p className="mt-1 text-text-muted">Ele pode ter sido apagado.</p>
          <Link href="/" className="mt-4 inline-block font-semibold text-accent underline">
            Criar um app novo
          </Link>
        </div>
      </div>
    );
  }

  const working = job?.status === "working" || live !== null;

  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Painéis" className="flex shrink-0 gap-1 border-b border-border bg-surface p-1.5 md:hidden">
        {(
          [
            ["chat", "Conversa"],
            ["app", "App"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={pane === value}
            onClick={() => setPane(value)}
            className="flex-1 rounded-sm py-1.5 text-sm font-medium text-text-muted aria-selected:bg-surface-2 aria-selected:text-text"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(var(--size-chat-min),var(--size-chat-default))_1fr]">
        <section
          aria-label="Conversa"
          className={`min-h-0 flex-col border-border bg-surface md:flex md:border-r ${pane === "chat" ? "flex" : "hidden"}`}
        >
          <header className="flex h-(--size-header) shrink-0 items-center justify-between gap-2 border-b border-border px-4">
            <h1 className="truncate text-sm font-semibold">{job?.title ?? "Carregando…"}</h1>
            {job && <StatusBadge status={working ? "working" : job.status} />}
          </header>
          <ChatLog messages={messages} live={live} loading={!job && !loadError} />
          {loadError && (
            <p role="alert" className="mx-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              Não foi possível carregar este app.{" "}
              <button className="font-semibold underline" onClick={refresh}>
                Tentar de novo
              </button>
            </p>
          )}
          <ChatComposer disabled={!job || working} onSend={(text, mode) => send(text, mode)} />
        </section>
        <PreviewPanel
          jobId={jobId}
          files={files}
          working={working}
          className={pane === "app" ? "flex" : "hidden md:flex"}
        />
      </div>
    </div>
  );
}

function ChatLog({ messages, live, loading }: { messages: Message[]; live: Live | null; loading: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const liveLen = live ? JSON.stringify(live.parts).length : 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, liveLen]);

  return (
    <div role="log" aria-live="polite" aria-busy={loading} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {!loading && messages.length === 0 && !live && (
        <p className="m-auto max-w-[32ch] text-center text-sm text-text-muted">
          Escreva o que você quer e o agente começa a construir.
        </p>
      )}
      {messages.map((m) => (
        <MessageView key={m.id} message={m} />
      ))}
      {live && (
        <>
          <MessageView message={live.user} />
          <AgentParts parts={live.parts} streaming />
        </>
      )}
      <div ref={end} />
    </div>
  );
}

function MessageView({ message }: { message: Message }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="max-w-[85%] self-end whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-surface-2 px-3.5 py-2.5 text-sm">
        {message.mode === "plan" && <span className="mb-1 block text-xs font-medium text-text-muted">Planejar</span>}
        {text}
      </div>
    );
  }
  return <AgentParts parts={message.parts} />;
}

const fileVerb = { created: "Criou", edited: "Editou", deleted: "Apagou" } as const;
const FileIcon = { created: FileText, edited: Pencil, deleted: Trash2 } as const;

function AgentParts({ parts, streaming = false }: { parts: MessagePart[]; streaming?: boolean }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <p key={i} className="whitespace-pre-wrap">
              {part.text}
            </p>
          );
        }
        if (part.type === "error") {
          return (
            <p key={i} role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-danger">
              {part.text}
            </p>
          );
        }
        const Icon = FileIcon[part.action];
        return (
          <p key={i} className="flex items-center gap-2 text-xs text-text-muted">
            <Check className="size-4 shrink-0" aria-hidden />
            {fileVerb[part.action]}
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-xs text-text">
              <Icon className="size-3.5" aria-hidden />
              {part.path}
            </span>
          </p>
        );
      })}
      {streaming && (
        <p className="flex items-center gap-2 text-xs text-working">
          <span className="inline-block h-3.5 w-[7px] animate-pulse-soft bg-working" aria-hidden />
          Montando o seu app…
        </p>
      )}
    </div>
  );
}

function ChatComposer({ disabled, onSend }: { disabled: boolean; onSend: (text: string, mode: Mode) => void }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("build");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 8 * 20 + 8)}px`;
  }, [text]);

  function submit() {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value, mode);
    setText("");
  }

  return (
    <form
      className="m-3 rounded-lg border border-border-input bg-surface py-2.5 pl-3.5 pr-2.5 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="chat-input" className="sr-only">
        Peça uma mudança
      </label>
      <textarea
        id="chat-input"
        ref={area}
        rows={2}
        maxLength={8000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Peça uma mudança, ex.: deixa o botão de cadastro verde"
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-text-muted"
      />
      <div className="flex items-center gap-2">
        <ModeToggle value={mode} onChange={setMode} />
        <span className="flex-1" />
        <Button type="submit" variant="primary" size="sm" iconOnly aria-label="Enviar" disabled={disabled || !text.trim()}>
          <ArrowUp className="size-4" />
        </Button>
      </div>
    </form>
  );
}

function PreviewPanel({
  jobId,
  files,
  working,
  className,
}: {
  jobId: string;
  files: Files;
  working: boolean;
  className: string;
}) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [phone, setPhone] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const html = useMemo(() => buildPreviewHtml(files), [files]);
  const paths = useMemo(() => Object.keys(files).sort(), [files]);
  const [selected, setSelected] = useState<string | null>(null);
  const shown = selected && selected in files ? selected : (paths.includes("index.html") ? "index.html" : paths[0]);

  return (
    <section aria-label="App" className={`min-h-0 min-w-0 flex-col bg-bg ${className}`}>
      <div className="relative flex h-(--size-header) shrink-0 items-center gap-1 border-b border-border bg-surface px-3">
        <div role="tablist" aria-label="Visualização" className="mr-auto flex gap-1">
          {(
            [
              ["preview", "Preview"],
              ["code", "Código"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className="rounded-sm px-2.5 py-1.5 text-sm font-medium text-text-muted aria-selected:bg-surface-2 aria-selected:text-text"
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={phone ? "Ver no computador" : "Ver no celular"}
          aria-pressed={phone}
          className="hidden md:inline-flex"
          onClick={() => setPhone((p) => !p)}
        >
          <Smartphone className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" iconOnly aria-label="Recarregar preview" onClick={() => setReloadKey((k) => k + 1)}>
          <RotateCw className="size-4" />
        </Button>
        <a
          href={`/api/jobs/${jobId}/preview`}
          target="_blank"
          rel="noopener"
          aria-label="Abrir em nova aba"
          className={`grid size-8 place-items-center rounded-md hover:bg-surface-2 ${html ? "" : "pointer-events-none opacity-50"}`}
        >
          <ExternalLink className="size-4" />
        </a>
        <Button variant="primary" size="sm" disabled title="A publicação chega na próxima etapa">
          <Globe className="size-4" />
          Publicar
        </Button>
        {working && (
          <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 overflow-hidden">
            <span className="absolute inset-y-0 w-[35%] animate-sweep bg-working" />
          </span>
        )}
      </div>

      {tab === "preview" ? (
        <div className="flex min-h-0 flex-1 justify-center p-4">
          {html ? (
            <iframe
              key={reloadKey}
              title="Preview do app"
              srcDoc={html}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className={`h-full rounded-md border border-border bg-white ${phone ? "w-[390px] max-w-full" : "w-full"}`}
            />
          ) : (
            <p className="m-auto max-w-[36ch] text-center text-sm text-text-muted">
              {working ? "Montando o seu app…" : "O seu app aparece aqui assim que o agente terminar a primeira versão."}
            </p>
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[180px_1fr]">
          <ul aria-label="Arquivos" className="overflow-y-auto border-r border-border bg-surface p-2">
            {paths.length === 0 && <li className="p-2 text-sm text-text-muted">Nenhum arquivo ainda.</li>}
            {paths.map((p) => (
              <li key={p}>
                <button
                  aria-current={p === shown ? "true" : undefined}
                  onClick={() => setSelected(p)}
                  className="w-full truncate rounded-sm px-2 py-1 text-left font-mono text-xs hover:bg-surface-2 aria-[current=true]:bg-accent-soft"
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
          <pre className="min-w-0 overflow-auto p-4 font-mono text-xs leading-relaxed">
            <code>{shown ? files[shown] : ""}</code>
          </pre>
        </div>
      )}
    </section>
  );
}
