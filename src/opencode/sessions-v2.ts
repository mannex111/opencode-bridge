/**
 * OpenCode v2 session 适配（新增，不影响现有 1.x 路径）
 *
 * v2 的 session API 在 /api/session*（需鉴权），响应形如 { data: Session.Info }；
 * session 的工作目录在 location.directory。这里用裸 fetch 提供最小可用集。
 */

import { opencodeConfig } from '../config.js';
import { withOpencodeAuthorizationHeaders } from './client-helpers.js';

export interface V2SessionInfo {
  id: string;
  title?: string;
  directory?: string;
  location?: { directory?: string };
  [key: string]: unknown;
}

export interface V2CreateSessionInput {
  title?: string;
  directory?: string;
}

function v2Headers(extra?: Record<string, string>): Record<string, string> {
  return withOpencodeAuthorizationHeaders({ 'Content-Type': 'application/json', ...(extra ?? {}) });
}

function v2Url(path: string): string {
  return `${opencodeConfig.baseUrl}/api${path}`;
}

function extractDirectory(session: V2SessionInfo): string | undefined {
  if (typeof session.directory === 'string' && session.directory) {
    return session.directory;
  }
  const dir = session.location?.directory;
  return typeof dir === 'string' && dir ? dir : undefined;
}

export async function createV2Session(input?: V2CreateSessionInput): Promise<V2SessionInfo | null> {
  const body: Record<string, unknown> = {};
  if (input?.title) body.title = input.title;
  if (input?.directory) body.directory = input.directory;

  const response = await fetch(v2Url('/session'), {
    method: 'POST',
    headers: v2Headers(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return null;
  }
  const json = (await response.json().catch(() => null)) as { data?: V2SessionInfo } | null;
  return json?.data ?? null;
}

export async function listV2Sessions(): Promise<V2SessionInfo[]> {
  const response = await fetch(v2Url('/session'), {
    method: 'GET',
    headers: v2Headers(),
  });
  if (!response.ok) {
    return [];
  }
  const json = (await response.json().catch(() => null)) as unknown;
  const record = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  const data = record?.data ?? record?.sessions ?? json;
  return Array.isArray(data) ? (data as V2SessionInfo[]) : [];
}

export async function getV2Session(id: string): Promise<V2SessionInfo | null> {
  const response = await fetch(v2Url(`/session/${encodeURIComponent(id)}`), {
    method: 'GET',
    headers: v2Headers(),
  });
  if (!response.ok) {
    return null;
  }
  const json = (await response.json().catch(() => null)) as { data?: V2SessionInfo } | null;
  return json?.data ?? null;
}

export async function deleteV2Session(id: string): Promise<boolean> {
  const response = await fetch(v2Url(`/session/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: v2Headers(),
  });
  return response.ok;
}

/** 从 v2 session 提取工作目录（location.directory 兜底） */
export function getV2SessionDirectory(session: V2SessionInfo): string | undefined {
  return extractDirectory(session);
}

export interface V2ProjectInfo {
  id?: string;
  worktree?: string;
  directory?: string;
  [key: string]: unknown;
}

export async function listV2Projects(): Promise<V2ProjectInfo[]> {
  const response = await fetch(v2Url('/project'), { method: 'GET', headers: v2Headers() });
  if (!response.ok) {
    return [];
  }
  const json = (await response.json().catch(() => null)) as unknown;
  const record = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  const data = record?.data ?? json;
  return Array.isArray(data) ? (data as V2ProjectInfo[]) : [];
}

export async function updateV2Session(id: string, title: string): Promise<boolean> {
  const response = await fetch(v2Url(`/session/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: v2Headers(),
    body: JSON.stringify({ title }),
  });
  return response.ok;
}

export async function getV2SessionMessages(id: string): Promise<Array<{ info?: unknown; parts?: unknown }>> {
  const response = await fetch(v2Url(`/session/${encodeURIComponent(id)}/message`), {
    method: 'GET',
    headers: v2Headers(),
  });
  if (!response.ok) {
    return [];
  }
  const json = (await response.json().catch(() => null)) as unknown;
  const record = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  const data = record?.data ?? json;
  return Array.isArray(data) ? (data as Array<{ info?: unknown; parts?: unknown }>) : [];
}
