"use client";

import { Check, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, JOBS_CHANGED, notifyJobsChanged, relativeTime } from "@/lib/client";
import type { Job } from "@/lib/types";
import { Button, StatusDot } from "./ui";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    api
      .listJobs()
      .then(({ jobs }) => {
        setJobs(jobs);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(JOBS_CHANGED, load);
    return () => window.removeEventListener(JOBS_CHANGED, load);
  }, [load]);

  // Keep "working" dots honest while something is being built.
  const anyWorking = jobs?.some((j) => j.status === "working");
  useEffect(() => {
    if (!anyWorking) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [anyWorking, load]);

  return (
    <nav aria-label="Seus apps" className="flex h-full min-w-0 flex-col gap-1 bg-bg p-3">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2 px-2 pb-3 pt-1 font-bold">
        <span className="grid size-[22px] place-items-center rounded-sm bg-accent text-on-accent">
          <Plus className="size-4" aria-hidden />
        </span>
        app-builder
      </Link>
      <Link
        href="/"
        onClick={onNavigate}
        className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-[color-mix(in_srgb,var(--color-accent)_88%,black)]"
      >
        <Plus className="size-4" aria-hidden />
        Novo app
      </Link>
      <h2 className="mx-2 mb-1 mt-4 text-xs font-medium text-text-muted">Seus apps</h2>
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
        {error && (
          <p className="px-2 text-sm text-danger">
            Não foi possível carregar seus apps.{" "}
            <button className="underline" onClick={load}>
              Tentar de novo
            </button>
          </p>
        )}
        {!error && jobs === null && <SkeletonRows />}
        {jobs?.length === 0 && (
          <p className="px-2 text-sm text-text-muted">Os apps que você criar aparecem aqui.</p>
        )}
        {jobs && jobs.length > 0 && (
          // Reading the URL is request data; it streams in after the static shell.
          <Suspense fallback={<SkeletonRows />}>
            <JobRows jobs={jobs} onNavigate={onNavigate} />
          </Suspense>
        )}
      </div>
    </nav>
  );
}

function JobRows({ jobs, onNavigate }: { jobs: Job[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return jobs.map((job) => (
    <JobRow key={job.id} job={job} active={pathname === `/job/${job.id}`} onNavigate={onNavigate} />
  ));
}

function SkeletonRows() {
  return (
    <div aria-hidden className="flex flex-col gap-2 px-2 pt-1">
      {[70, 55, 80].map((w) => (
        <div key={w} className="h-9 animate-pulse-soft rounded-md bg-surface-2" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function JobRow({ job, active, onNavigate }: { job: Job; active: boolean; onNavigate?: () => void }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(job.title);
  const dialog = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && (e.target as HTMLElement).closest("[data-job-menu]")) return;
      setMenu(false);
      if (e instanceof KeyboardEvent) menuButton.current?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  async function saveTitle() {
    const next = title.trim();
    setRenaming(false);
    if (!next || next === job.title) return setTitle(job.title);
    await api.renameJob(job.id, next).catch(() => setTitle(job.title));
    notifyJobsChanged();
  }

  async function remove() {
    dialog.current?.close();
    await api.deleteJob(job.id);
    notifyJobsChanged();
    if (active) router.push("/");
  }

  if (renaming) {
    return (
      <form
        className="flex items-center gap-1 rounded-md bg-surface-2 p-1"
        onSubmit={(e) => {
          e.preventDefault();
          saveTitle();
        }}
      >
        <label className="sr-only" htmlFor={`rename-${job.id}`}>
          Novo nome
        </label>
        <input
          id={`rename-${job.id}`}
          autoFocus
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setTitle(job.title);
              setRenaming(false);
            }
          }}
          className="h-8 min-w-0 flex-1 rounded-sm border border-border-input bg-surface px-2 text-sm"
        />
        <Button type="submit" variant="ghost" size="sm" iconOnly aria-label="Salvar nome">
          <Check className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Cancelar"
          onClick={() => {
            setTitle(job.title);
            setRenaming(false);
          }}
        >
          <X className="size-4" />
        </Button>
      </form>
    );
  }

  return (
    <div className="group relative" data-job-menu>
      <Link
        href={`/job/${job.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className="grid grid-cols-[auto_1fr] items-center gap-x-2 rounded-md py-2 pl-2 pr-9 hover:bg-surface-2 aria-[current=page]:bg-accent-soft"
      >
        <StatusDot status={job.status} />
        <span className="truncate text-sm font-medium">{job.title}</span>
        <span className="col-start-2 text-xs text-text-muted">{relativeTime(job.updatedAt)}</span>
      </Link>
      <button
        ref={menuButton}
        aria-label={`Opções de ${job.title}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
        className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-sm text-text-muted opacity-0 hover:bg-surface focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {menu && (
        <div
          role="menu"
          className="absolute right-1 top-full z-20 mt-1 w-40 rounded-md border border-border bg-surface p-1 shadow-pop"
        >
          <button
            role="menuitem"
            autoFocus
            onClick={() => {
              setMenu(false);
              setRenaming(true);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-2"
          >
            <Pencil className="size-4" /> Renomear
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(false);
              dialog.current?.showModal();
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-danger hover:bg-danger-soft"
          >
            <Trash2 className="size-4" /> Apagar
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={`del-${job.id}`}
        className="m-auto w-[min(400px,calc(100vw-32px))] rounded-lg bg-surface p-5 text-text shadow-pop backdrop:bg-black/40"
      >
        <h2 id={`del-${job.id}`} className="text-lg font-semibold">
          Apagar “{job.title}”?
        </h2>
        <p className="mt-1 text-sm text-text-muted">A conversa e todas as versões do app somem. Não dá para desfazer.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => dialog.current?.close()}>Cancelar</Button>
          <Button variant="danger" onClick={remove}>
            Apagar app
          </Button>
        </div>
      </dialog>
    </div>
  );
}
