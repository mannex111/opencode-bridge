import { describe, expect, it } from 'vitest';
import { mapV2Event } from '../src/opencode/event-mapper-v2.js';

// 下列 data 均取自隔离环境 (v2.0.28) 实测抓到的真实事件。
const SID = 'ses_eca1b89fcffewYarp7XekJUYSF';
const AMID = 'msg_135e47a57001HQh0k9eVGnYAiB';

describe('mapV2Event (OpenCode v2 -> 内部事件)', () => {
  it('server.connected / 未知事件 -> 忽略', () => {
    expect(mapV2Event({ type: 'server.connected', data: {} })).toEqual([]);
    expect(mapV2Event({ type: 'session.inbox.enqueued', data: { sessionID: SID } })).toEqual([]);
    expect(mapV2Event({ type: 'some.unknown', data: { sessionID: SID } })).toEqual([]);
  });

  it('缺少 sessionID / data -> 忽略', () => {
    expect(mapV2Event({ type: 'session.text.delta', data: {} })).toEqual([]);
    expect(mapV2Event({ type: 'session.text.delta' })).toEqual([]);
  });

  it('session.text.delta -> messagePartUpdated(text)', () => {
    const out = mapV2Event({
      type: 'session.text.delta',
      data: { sessionID: SID, assistantMessageID: AMID, ordinal: 0, delta: 'pong' },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      type: 'messagePartUpdated',
      payload: {
        sessionID: SID,
        part: { type: 'text', id: `${AMID}:text:0`, messageID: AMID, sessionID: SID },
        delta: 'pong',
      },
    });
  });

  it('session.reasoning.delta -> messagePartUpdated(reasoning)', () => {
    const out = mapV2Event({
      type: 'session.reasoning.delta',
      data: { sessionID: SID, assistantMessageID: AMID, ordinal: 1, delta: '思考中' },
    });
    expect(out[0].type).toBe('messagePartUpdated');
    const payload = out[0].payload as { part: { type: string; id: string }; delta: string };
    expect(payload.part.type).toBe('reasoning');
    expect(payload.part.id).toBe(`${AMID}:reasoning:1`);
    expect(payload.delta).toBe('思考中');
  });

  it('session.tool.called -> messagePartUpdated(tool, running, input)', () => {
    const out = mapV2Event({
      type: 'session.tool.called',
      data: {
        sessionID: SID,
        assistantMessageID: AMID,
        id: 'call_00_As4OXdtSyGC4fNCaqRAG8196',
        name: 'shell',
        input: { command: 'echo hello-world' },
      },
    });
    expect(out).toHaveLength(1);
    const payload = out[0].payload as { part: { type: string; tool: string; callID: string; state: { status: string; input: unknown } } };
    expect(payload.part.type).toBe('tool');
    expect(payload.part.tool).toBe('shell');
    expect(payload.part.callID).toBe('call_00_As4OXdtSyGC4fNCaqRAG8196');
    expect(payload.part.state.status).toBe('running');
    expect(payload.part.state.input).toEqual({ command: 'echo hello-world' });
  });

  it('session.tool.success -> messagePartUpdated(tool, completed, text output)', () => {
    const out = mapV2Event({
      type: 'session.tool.success',
      data: {
        sessionID: SID,
        assistantMessageID: AMID,
        id: 'call_x',
        name: 'shell',
        content: [{ type: 'text', text: 'hello-world\n' }],
        metadata: { status: 'completed', truncated: false, exit: 0 },
      },
    });
    const payload = out[0].payload as { part: { state: { status: string; output: string } } };
    expect(payload.part.state.status).toBe('completed');
    expect(payload.part.state.output).toBe('hello-world\n');
  });

  it('session.tool.failed -> messagePartUpdated(tool, failed)', () => {
    const out = mapV2Event({
      type: 'session.tool.failed',
      data: { sessionID: SID, assistantMessageID: AMID, id: 'call_y', name: 'shell', error: 'boom' },
    });
    const payload = out[0].payload as { part: { state: { status: string; output: string } } };
    expect(payload.part.state.status).toBe('failed');
    expect(payload.part.state.output).toBe('boom');
  });

  it('session.execution.succeeded -> sessionIdle', () => {
    expect(mapV2Event({ type: 'session.execution.succeeded', data: { sessionID: SID } })).toEqual([
      { type: 'sessionIdle', payload: { sessionID: SID } },
    ]);
  });

  it('session.execution.failed -> sessionError', () => {
    const out = mapV2Event({
      type: 'session.execution.failed',
      data: { sessionID: SID, error: { type: 'provider.auth', message: 'Endpoint is unavailable.' } },
    });
    expect(out[0].type).toBe('sessionError');
    expect((out[0].payload as { error: { type: string } }).error.type).toBe('provider.auth');
  });

  it('session.step.ended -> messageUpdated(cost/tokens)', () => {
    const out = mapV2Event({
      type: 'session.step.ended',
      data: {
        sessionID: SID,
        assistantMessageID: AMID,
        finish: 'stop',
        cost: 0.000733452,
        tokens: { input: 4870, output: 3, reasoning: 0, cache: { read: 384, write: 0 } },
      },
    });
    expect(out[0].type).toBe('messageUpdated');
    const info = (out[0].payload as { info: { id: string; cost: number } }).info;
    expect(info.id).toBe(AMID);
    expect(info.cost).toBeCloseTo(0.000733452, 6);
  });
});
