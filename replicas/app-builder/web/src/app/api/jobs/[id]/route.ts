import { getUserId } from "@/lib/session";
import { getStore } from "@/lib/store";
import { badRequest, notFound, readJson, text } from "@/lib/validate";

export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const store = getStore();
  const job = await store.getJob(await getUserId(), id);
  if (!job) return notFound();
  const [messages, files] = await Promise.all([store.listMessages(id), store.getCurrentFiles(id)]);
  return Response.json({ job, messages, files });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  try {
    const body = await readJson(req);
    const job = await getStore().updateJob(await getUserId(), id, { title: text(body.title, "title", 120) });
    return job ? Response.json({ job }) : notFound();
  } catch (err) {
    return badRequest(err);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const deleted = await getStore().deleteJob(await getUserId(), id);
  return deleted ? new Response(null, { status: 204 }) : notFound();
}
