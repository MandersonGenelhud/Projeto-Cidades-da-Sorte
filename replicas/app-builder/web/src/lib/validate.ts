import type { AppType, Mode } from "./types";

export const APP_TYPES: readonly AppType[] = ["web", "landing", "raffle", "brainstorm"];
export const MODES: readonly Mode[] = ["build", "plan"];
export const MAX_MESSAGE = 8000;

export class BadRequest extends Error {}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  throw new BadRequest("Corpo da requisição inválido.");
}

export function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new BadRequest(`Campo obrigatório: ${field}.`);
  if (value.length > max) throw new BadRequest(`${field} passou de ${max} caracteres.`);
  return value.trim();
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new BadRequest(`Valor inválido para ${field}.`);
}

export function badRequest(err: unknown) {
  if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 });
  throw err;
}

export const notFound = () => Response.json({ error: "App não encontrado." }, { status: 404 });
