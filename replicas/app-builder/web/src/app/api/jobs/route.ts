import { getUserId } from "@/lib/session";
import { getStore } from "@/lib/store";
import { APP_TYPES, badRequest, oneOf, readJson } from "@/lib/validate";

export async function GET() {
  const jobs = await getStore().listJobs(await getUserId());
  return Response.json({ jobs });
}

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const appType = oneOf(body.appType, APP_TYPES, "appType");
    const job = await getStore().createJob(await getUserId(), { title: "Novo app", appType });
    return Response.json({ job }, { status: 201 });
  } catch (err) {
    return badRequest(err);
  }
}
