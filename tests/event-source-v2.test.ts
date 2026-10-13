import { describe, expect, it } from 'vitest';
import { SseDataBuffer, mapV2SseDataLine } from '../src/opencode/event-source-v2.js';

// 真实抓包（隔离 v2.0.28）的一个 SSE 片段
const RAW = [
  '',
  'data: {"id":"evt_1","type":"server.connected","data":{}}',
  '',
  ': heartbeat',
  '',
  'data: {"id":"evt_2","type":"session.execution.started","data":{"sessionID":"ses_x"}}',
  '',
  'data: {"id":"evt_3","type":"session.text.delta","data":{"sessionID":"ses_x","assistantMessageID":"msg_y","ordinal":0,"delta":"pong"}}',
  '',
].join('\n');

describe('SseDataBuffer', () => {
  it('从原始 SSE 文本抽取 data 载荷，忽略注释/空行', () => {
    const buf = new SseDataBuffer();
    const payloads = buf.push(RAW);
    expect(payloads).toHaveLength(3);
    expect(payloads[0]).toContain('server.connected');
    expect(payloads[2]).toContain('session.text.delta');
  });

  it('分片到达时能正确拼回完整行', () => {
    const buf = new SseDataBuffer();
    const first = buf.push('data: {"type":"session.exec');
    expect(first).toEqual([]);
    const second = buf.push('ution.succeeded","data":{"sessionID":"ses_x"}}\n\n');
    expect(second).toHaveLength(1);
    expect(mapV2SseDataLine(second[0])).toEqual([
      { type: 'sessionIdle', payload: { sessionID: 'ses_x' } },
    ]);
  });
});

describe('mapV2SseDataLine', () => {
  it('解析 JSON 并映射为内部事件', () => {
    const out = mapV2SseDataLine(
      '{"type":"session.text.delta","data":{"sessionID":"ses_x","assistantMessageID":"msg_y","ordinal":0,"delta":"hi"}}'
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('messagePartUpdated');
  });

  it('非法 JSON 安全返回空', () => {
    expect(mapV2SseDataLine('not json')).toEqual([]);
  });
});
