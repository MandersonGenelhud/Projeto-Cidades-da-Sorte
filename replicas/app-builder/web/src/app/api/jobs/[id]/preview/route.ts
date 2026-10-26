import { buildPreviewHtml } from "@/lib/preview";
import { getUserId } from "@/lib/session";
import { getStore } from "@/lib/store";

/** The generated app in a tab of its own, sandboxed away from this site's cookies. */
export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]/preview">) {
  const { id } = await ctx.params;
  const store = getStore();
  if (!(await store.getJob(await getUserId(), id))) {
    return new Response("App não encontrado.", { status: 404 });
  }
  const html = buildPreviewHtml(await store.getCurrentFiles(id));
  if (html === null) return new Response("Este app ainda não tem uma página inicial.", { status: 404 });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-modals allow-popups",
      "Cache-Control": "no-store",
    },
  });
}
