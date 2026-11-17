import { Hono, type Context } from 'hono';
import type { Database } from './database';

export type Session = { digest: string; userId: string };
export type Env = {
  Bindings: { DB: Database; ORIGIN: string };
  Variables: { session: Session };
};
export type ApiContext = Context<Env>;
export const router = () => new Hono<Env>();
export class ApiError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 415 | 422 | 429 | 503,
              readonly code: string, message: string) { super(message); }
}
export async function body(c: ApiContext): Promise<Record<string, unknown>> {
  const input = await c.req.json().catch(() => null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  return input;
}
export function invalid(message = '请检查输入后重试。'): never {
  throw new ApiError(422, 'invalid_input', message);
}
export function conflict(code: string, message: string): never {
  throw new ApiError(409, code, message);
}
export function missing(): never {
  throw new ApiError(404, 'not_found', '找不到这项内容。');
}
export function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
export function requestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value)) invalid();
  return value;
}
export function id(c: ApiContext): string { return c.get('session').userId; }
export const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
export const secret = (size = 32) => encode(crypto.getRandomValues(new Uint8Array(size)));
export async function digest(value: string) {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
