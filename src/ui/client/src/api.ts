import type { RequestDetail, SessionDetail, SessionSummary } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${url}`);
  }
  return (await res.json()) as T;
}

export function fetchSessions(): Promise<SessionSummary[]> {
  return getJson<SessionSummary[]>("/api/sessions");
}

export function fetchSession(id: number): Promise<SessionDetail> {
  return getJson<SessionDetail>(`/api/sessions/${id}`);
}

export function fetchRequest(
  sessionId: number,
  requestId: number
): Promise<RequestDetail> {
  return getJson<RequestDetail>(
    `/api/sessions/${sessionId}/requests/${requestId}`
  );
}
