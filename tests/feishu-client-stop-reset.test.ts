import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feishuClient } from '../src/feishu/client.js';

type InternalFeishuClient = typeof feishuClient & {
  eventDispatcher: object;
  cardActionHandler?: (event: unknown) => Promise<unknown>;
  cardUpdateQueue: Map<string, Promise<boolean>>;
  handleCardAction: (event: unknown) => Promise<unknown>;
};

describe('FeishuClient stop state reset', () => {
  const internalClient = feishuClient as InternalFeishuClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    feishuClient.removeAllListeners('cardAction');
  });

  afterEach(() => {
    feishuClient.removeAllListeners('cardAction');
    internalClient.stop();
  });

  it('stop 应重置事件分发器与更新队列，但保留卡片处理器接线（Bug 17）', async () => {
    const previousDispatcher = internalClient.eventDispatcher;
    const previousHandler = vi.fn(async () => ({ msg: 'handled' }));
    const cardActionSpy = vi.fn();

    feishuClient.on('cardAction', cardActionSpy);
    internalClient.setCardActionHandler(previousHandler);
    internalClient.cardUpdateQueue.set('msg-1', Promise.resolve(true));

    internalClient.stop();

    expect(internalClient.eventDispatcher).not.toBe(previousDispatcher);
    expect(internalClient.cardActionHandler).toBe(previousHandler);
    expect(internalClient.cardUpdateQueue.size).toBe(0);

    const response = await internalClient.handleCardAction({
      operator: { open_id: 'ou_test_user' },
      action: { tag: 'button', value: { action: 'restart' } },
      token: 'card-token',
      open_message_id: 'om_msg_1',
      open_chat_id: 'oc_chat_1',
      open_thread_id: 'ot_thread_1',
    });

    expect(previousHandler).toHaveBeenCalledTimes(1);
    expect(cardActionSpy).not.toHaveBeenCalled();
    expect(response).toEqual({ msg: 'handled' });
  });
});
