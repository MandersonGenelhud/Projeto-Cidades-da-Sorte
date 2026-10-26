"use client";

import { Menu, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Button } from "./ui";

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-(--size-sidebar) shrink-0 border-r border-border lg:block">
        <Sidebar />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button aria-label="Fechar menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="relative h-full w-[min(var(--size-sidebar),85vw)] border-r border-border shadow-pop">
            <Sidebar onNavigate={() => setDrawer(false)} />
            <Button variant="ghost" size="sm" iconOnly aria-label="Fechar menu" className="absolute right-2 top-2" onClick={() => setDrawer(false)}>
              <X className="size-4" />
            </Button>
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg px-3 lg:hidden">
          <Button variant="ghost" size="sm" iconOnly aria-label="Abrir menu" onClick={() => setDrawer(true)}>
            <Menu className="size-4" />
          </Button>
          <span className="font-bold">app-builder</span>
        </div>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
