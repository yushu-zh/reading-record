import { QueryClient } from '@tanstack/react-query';
import type { CheckInInput } from '../../../packages/contracts';

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
export const offlineMessage = '暂时无法连接，请恢复网络后手动重试。';
export async function api<T>(path: string, method = 'GET', data?: object, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/v1' + path, {
      method, cache:'no-store', credentials:'same-origin', signal,
      ...(method === 'GET' ? {} : { headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(data ?? {}) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RequestError(offlineMessage,0,'offline');
  }
  const result = await response.json().catch(() => null);
  const error = result as {message?:string; code?:string} | null;
  if (!response.ok || result === null) {
    throw new RequestError(error?.message ?? '服务暂时不可用，请稍后重试。',response.status,error?.code ?? 'invalid_response');
  }
  return result as T;
}
export const query = new QueryClient({
  defaultOptions: { queries:{ retry:false, refetchOnWindowFocus:false, refetchOnReconnect:false, networkMode:'always' } },
});
export const errorText = (error: unknown) => {
  if (error instanceof RequestError) return error.message;
  return '操作未完成，请稍后重试。';
};
export type Draft = CheckInInput & { bookId:string };
const draftKey = (user: string) => 'reading-draft:' + user;
export function readDraft(user: string): Draft | null {
  try { return JSON.parse(sessionStorage.getItem(draftKey(user)) ?? 'null'); }
  catch { return null; }
}
export function saveDraft(user: string, draft: Draft | null) {
  try {
    if (draft) sessionStorage.setItem(draftKey(user),JSON.stringify(draft));
    else sessionStorage.removeItem(draftKey(user));
  } catch { /* Storage can be unavailable in the browser. The current form stays in memory. */ }
}
export const DRAFT_EVENT = 'reading-draft-change';
export function updateDraft(user: string, draft: Draft | null) {
  saveDraft(user,draft);
  window.dispatchEvent(new Event(DRAFT_EVENT));
}
