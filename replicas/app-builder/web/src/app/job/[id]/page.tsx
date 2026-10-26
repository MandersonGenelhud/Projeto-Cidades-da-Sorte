import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { Workspace } from "@/components/workspace";

export default function JobPage({ params }: PageProps<"/job/[id]">) {
  return (
    <AppShell>
      <Suspense fallback={<p className="p-6 text-sm text-text-muted">Carregando…</p>}>
        {params.then(({ id }) => (
          <Workspace key={id} jobId={id} />
        ))}
      </Suspense>
    </AppShell>
  );
}
