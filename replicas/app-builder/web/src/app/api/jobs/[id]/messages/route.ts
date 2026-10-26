import { getAgent } from "@/lib/agent";
import { runAgent } from "@/lib/agent/runner";
import { getUserId } from "@/lib/session";
import { getStore } from "@/lib/store";
import type { AgentEvent } from "@/lib/types";
import { badRequest, MAX_MESSAGE, MODES, notFound, oneOf, readJson, text } from "@/lib/validate";

export const maxDuration = 300;

/** Runs one agent turn and streams its progress as server-sent events. */
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/messages">) {
  const { id } = await ctx.params;
  const userId = await getUserId();
  let input: { text: string; mode: "build" | "plan"; clientId: string };
  try {
    const body = await readJson(req);
    input = {
      text: text(body.text, "text", MAX_MESSAGE),
      mode: oneOf(body.mode, MODES, "mode"),
      clientId: text(body.clientId, "clientId", 100),
    };
  } catch (err) {
    return badRequest(err);
  }
  const store = getStore();
  if (!(await store.getJob(userId, id))) return notFound();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const emit = (event: AgentEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false; // The browser left; the run continues and is saved.
        }
      };
      // Not tied to the request: a closed tab must not throw away finished work.
      runAgent({ store, agent: getAgent(), userId, jobId: id, ...input, emit })
        .catch((err) => {
          console.error("agent run crashed", id, err);
          emit({ type: "error", message: "Algo deu errado do nosso lado. Tente de novo." });
        })
        .finally(() => {
          if (open) controller.close();
          open = false;
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
