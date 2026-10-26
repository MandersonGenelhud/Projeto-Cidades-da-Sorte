"use client";

import { ArrowUp, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, notifyJobsChanged, pendingFirstMessage } from "@/lib/client";
import type { AppType, Mode } from "@/lib/types";
import { Button, ModeToggle } from "./ui";

const TYPES: { value: AppType; label: string; hint: string; example: string }[] = [
  {
    value: "raffle",
    label: "Site de sorteio",
    hint: "Modelo por cidade",
    example: "Um site de sorteio para Campinas com cadastro de participantes e contagem regressiva",
  },
  {
    value: "web",
    label: "App completo",
    hint: "Telas, dados e login",
    example: "Um app para controlar as inscrições de um torneio de futebol do bairro",
  },
  {
    value: "landing",
    label: "Página de apresentação",
    hint: "Uma página que vende",
    example: "Uma página para a minha loja de bolos caseiros com cardápio e botão de WhatsApp",
  },
  {
    value: "brainstorm",
    label: "Conversar a ideia",
    hint: "Sem gastar construindo",
    example: "Quero criar um app para sorteios nas cidades do interior. Por onde começo?",
  },
];

export function HomeComposer() {
  const [appType, setAppType] = useState<AppType>("raffle");
  const [mode, setMode] = useState<Mode>("build");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const current = TYPES.find((t) => t.value === appType)!;

  async function submit() {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { job } = await api.createJob(appType);
      pendingFirstMessage.set(job.id, {
        text: prompt,
        mode: appType === "brainstorm" ? "plan" : mode,
        clientId: crypto.randomUUID(),
      });
      notifyJobsChanged();
      router.push(`/job/${job.id}`);
      // Next.js keeps this screen mounted (hidden) after navigating away;
      // clear it so "Novo app" comes back to an empty form.
      setText("");
      setBusy(false);
    } catch {
      setError("Não foi possível criar o app. Confira a conexão e tente de novo.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-center px-4 py-12">
      <h1 className="text-[clamp(2rem,5vw,var(--text-display))] font-bold leading-[1.1] tracking-[-0.02em]">
        O que você quer criar hoje?
      </h1>
      <p className="mt-2 text-text-muted">Descreva com suas palavras. O agente monta o app e mostra ao vivo.</p>

      <div role="radiogroup" aria-label="Tipo de app" className="mt-8 grid grid-cols-2 gap-2 md:grid-cols-4">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={appType === t.value}
            onClick={() => setAppType(t.value)}
            className="flex flex-col items-start gap-0.5 rounded-md border border-border bg-surface px-3 py-2.5 text-left text-sm hover:bg-surface-2 aria-checked:border-accent aria-checked:bg-accent-soft"
          >
            <span className="font-medium">{t.label}</span>
            <span className="text-xs text-text-muted">{t.hint}</span>
          </button>
        ))}
      </div>

      <form
        className="mt-3 rounded-lg border border-border-input bg-surface p-3 pl-4 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="idea" className="sr-only">
          Descreva o seu app
        </label>
        <textarea
          id="idea"
          rows={4}
          value={text}
          maxLength={8000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={`Ex.: ${current.example}`}
          className="w-full resize-none bg-transparent text-base outline-none placeholder:text-text-muted"
        />
        <div className="mt-2 flex items-center gap-2">
          {appType !== "brainstorm" && <ModeToggle value={mode} onChange={setMode} />}
          <span className="flex-1" />
          <Button type="submit" variant="primary" disabled={!text.trim() || busy} aria-busy={busy}>
            {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
            Criar app
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="mt-3 text-xs text-text-muted">
        Enter envia e Shift+Enter quebra a linha. No modo Planejar o agente só propõe um plano, sem construir.
      </p>
    </div>
  );
}
