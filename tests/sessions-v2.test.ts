import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createV2Session,
  deleteV2Session,
  getV2Session,
  getV2SessionDirectory,
  listV2Sessions,
} from '../src/opencode/sessions-v2.js';

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

describe('sessions-v2', () => {
  it('createV2Session 解析 { data: Session.Info }', async () => {
    global.fetch = mockFetch(200, { data: { id: 'ses_1', title: 'T', location: { directory: '/work/p' } } });
    const session = await createV2Session({ title: 'T' });
    expect(session?.id).toBe('ses_1');
    expect(getV2SessionDirectory(session!)).toBe('/work/p');
  });

  it('createV2Session 非 2xx 返回 null', async () => {
    global.fetch = mockFetch(500, {});
    expect(await createV2Session()).toBeNull();
  });

  it('listV2Sessions 解析数组', async () => {
    global.fetch = mockFetch(200, { data: [{ id: 'a' }, { id: 'b' }] });
    const list = await listV2Sessions();
    expect(list.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('listV2Sessions 失败返回空数组', async () => {
    global.fetch = mockFetch(401, {});
    expect(await listV2Sessions()).toEqual([]);
  });

  it('getV2Session / deleteV2Session', async () => {
    global.fetch = mockFetch(200, { data: { id: 'ses_9' } });
    expect((await getV2Session('ses_9'))?.id).toBe('ses_9');

    global.fetch = mockFetch(200, {});
    expect(await deleteV2Session('ses_9')).toBe(true);
  });

  it('getV2SessionDirectory 优先 directory，回退 location.directory', () => {
    expect(getV2SessionDirectory({ id: 'x', directory: '/d1', location: { directory: '/d2' } })).toBe('/d1');
    expect(getV2SessionDirectory({ id: 'x', location: { directory: '/d2' } })).toBe('/d2');
    expect(getV2SessionDirectory({ id: 'x' })).toBeUndefined();
  });
});
