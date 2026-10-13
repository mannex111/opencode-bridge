/**
 * OpenCode API 方言探测（新增，不影响现有 1.x 行为）
 *
 * 1.x 的 API 在根路径（GET /config、/session…），v2 全部搬到 /api/*（需鉴权）。
 * 这里探测当前连接的 server 是 v1 还是 v2，供事件源/请求路径按方言分流。
 *
 * 显式覆盖：环境变量 OPENCODE_API_VERSION=1|2（默认 auto 探测）。
 */

import { opencodeConfig } from '../config.js';
import { withOpencodeAuthorizationHeaders } from './client-helpers.js';

export type ApiDialect = 'v1' | 'v2';

let cached: ApiDialect | null = null;

export function getConfiguredDialect(): ApiDialect | 'auto' {
  const value = (process.env.OPENCODE_API_VERSION || 'auto').trim().toLowerCase();
  if (value === '1' || value === 'v1') return 'v1';
  if (value === '2' || value === 'v2') return 'v2';
  return 'auto';
}

export function getCachedDialect(): ApiDialect | null {
  return cached;
}

export function setCachedDialect(dialect: ApiDialect | null): void {
  cached = dialect;
}

/**
 * 探测方言。v2 的 GET /api/config 带鉴权返回 200 + JSON；1.x 该路径为 404。
 * 探测失败保守回退 v1（保持现有行为）。
 */
export async function detectApiDialect(): Promise<ApiDialect> {
  const configured = getConfiguredDialect();
  if (configured !== 'auto') {
    cached = configured;
    return configured;
  }
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(`${opencodeConfig.baseUrl}/api/config`, {
      method: 'GET',
      headers: withOpencodeAuthorizationHeaders(),
    });
    const contentType = response.headers.get('content-type') || '';
    const dialect: ApiDialect =
      response.ok && contentType.includes('application/json') ? 'v2' : 'v1';
    cached = dialect;
    console.log(`[OpenCode] API 方言探测: ${dialect}`);
    return dialect;
  } catch {
    cached = 'v1';
    return 'v1';
  }
}
