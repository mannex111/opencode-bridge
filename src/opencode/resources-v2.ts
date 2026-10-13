/**
 * OpenCode v2 资源适配（新增，不影响现有 1.x 路径）
 *
 * v2 的 provider/agent/command/config 在 /api/*（需鉴权），响应形如 { location, data }。
 * 这里用裸 fetch 提供最小可用集，供 providers.ts / command-cache.ts 在 v2 方言下调用。
 */

import { opencodeConfig } from '../config.js';
import { withOpencodeAuthorizationHeaders } from './client-helpers.js';

export interface V2ProviderInfo {
  id: string;
  name?: string;
  models?: unknown;
  [key: string]: unknown;
}

export interface V2AgentInfo {
  id: string;
  name?: string;
  description?: string;
  mode?: string;
  hidden?: boolean;
  [key: string]: unknown;
}

export interface V2CommandInfo {
  name: string;
  description?: string;
  [key: string]: unknown;
}

function v2Headers(): Record<string, string> {
  return withOpencodeAuthorizationHeaders({ 'Content-Type': 'application/json' });
}

async function v2GetData<T>(path: string): Promise<T[]> {
  try {
    const response = await fetch(`${opencodeConfig.baseUrl}/api${path}`, {
      method: 'GET',
      headers: v2Headers(),
    });
    if (!response.ok) {
      return [];
    }
    const json = (await response.json().catch(() => null)) as unknown;
    const record = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
    const data = record?.data ?? json;
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

export async function listV2Providers(): Promise<V2ProviderInfo[]> {
  return v2GetData<V2ProviderInfo>('/provider');
}

export async function listV2Agents(): Promise<V2AgentInfo[]> {
  return v2GetData<V2AgentInfo>('/agent');
}

export async function listV2Commands(): Promise<V2CommandInfo[]> {
  return v2GetData<V2CommandInfo>('/command');
}

export async function getV2Config(): Promise<unknown | null> {
  try {
    const response = await fetch(`${opencodeConfig.baseUrl}/api/config`, {
      method: 'GET',
      headers: v2Headers(),
    });
    if (!response.ok) {
      return null;
    }
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}
