import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getV2Config,
  listV2Agents,
  listV2Commands,
  listV2Providers,
} from '../src/opencode/resources-v2.js';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resources-v2', () => {
  it('listV2Providers 解析 { location, data:[...] }', async () => {
    global.fetch = mockFetch(200, {
      location: { directory: '/x' },
      data: [{ id: 'opencode-go', name: 'OpenCode Go' }, { id: 'opencode', name: 'OpenCode' }],
    });
    const providers = await listV2Providers();
    expect(providers.map((p) => p.id)).toEqual(['opencode-go', 'opencode']);
  });

  it('listV2Agents 解析 data 数组', async () => {
    global.fetch = mockFetch(200, { data: [{ id: 'build', name: 'Build', mode: 'primary' }] });
    const agents = await listV2Agents();
    expect(agents[0]).toMatchObject({ id: 'build', name: 'Build' });
  });

  it('listV2Commands 解析 data 数组', async () => {
    global.fetch = mockFetch(200, { data: [{ name: 'init', description: 'guided AGENTS.md setup' }] });
    const commands = await listV2Commands();
    expect(commands).toEqual([{ name: 'init', description: 'guided AGENTS.md setup' }]);
  });

  it('非 2xx 时列表返回空、config 返回 null', async () => {
    global.fetch = mockFetch(401, {});
    expect(await listV2Providers()).toEqual([]);
    expect(await listV2Agents()).toEqual([]);
    expect(await listV2Commands()).toEqual([]);
    expect(await getV2Config()).toBeNull();
  });

  it('getV2Config 解析对象', async () => {
    global.fetch = mockFetch(200, [{ type: 'directory', path: '/tmp/oc-v2/config/opencode' }]);
    expect(await getV2Config()).toEqual([{ type: 'directory', path: '/tmp/oc-v2/config/opencode' }]);
  });
});
