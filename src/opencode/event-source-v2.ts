/**
 * OpenCode v2 SSE 事件源（新增并行路径，不影响现有 1.x SDK 订阅）
 *
 * v2 的事件流在 GET /api/event（1.x 是 GET /event），SSE 帧为 `data: {json}`，
 * 另会发送 `: heartbeat` 注释行。本模块负责：连接、按行解析、转成内部事件。
 */

import { mapV2Event, type InternalOpencodeEvent } from './event-mapper-v2.js';

export interface V2SseDeps {
  baseUrl: string;
  headers?: Record<string, string>;
  onInternalEvent: (event: InternalOpencodeEvent) => void;
  onError?: (error: unknown) => void;
}

/** 增量 SSE 行缓冲：喂 SSE 文本片段，吐出完整的 data 载荷字符串 */
export class SseDataBuffer {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload) {
          out.push(payload);
        }
      }
      index = this.buffer.indexOf('\n');
    }
    return out;
  }
}

/** 单行 data 载荷 -> 内部事件（JSON 解析失败安全返回空） */
export function mapV2SseDataLine(payload: string): InternalOpencodeEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  return mapV2Event(parsed as { type?: unknown; data?: unknown });
}

/**
 * 连接 v2 事件流并持续把 v2 事件映射成内部事件回调。
 * 返回一个可 abort 的控制器；调用方负责重连策略（与现有 1.x 路径一致）。
 */
export async function connectV2EventStream(
  deps: V2SseDeps,
  signal: AbortSignal
): Promise<void> {
  const url = `${deps.baseUrl.replace(/\/$/, '')}/api/event`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'text/event-stream', ...(deps.headers ?? {}) },
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`v2 事件流订阅失败 (HTTP ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseDataBuffer();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const payload of sse.push(chunk)) {
        for (const internal of mapV2SseDataLine(payload)) {
          deps.onInternalEvent(internal);
        }
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      deps.onError?.(error);
      throw error;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}
