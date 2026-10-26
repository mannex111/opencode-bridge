/**
 * OpenCode v2 事件映射（新增并行路径，不影响现有 1.x 处理）
 *
 * v2 的事件信封为 { id, created, type, location?, metadata?, data, durable? }，
 * 载荷在 data（1.x 是 properties）；事件词汇也从 message.part.updated/session.idle
 * 变为 session.text.* / session.reasoning.* / session.tool.* / session.execution.*。
 *
 * 本模块把 v2 事件翻译成桥接器内部既有的 emitEvent(type, payload) 契约，
 * 从而复用下游的 event-hub / stream-accumulator / 卡片渲染，无需改动它们。
 */

export interface InternalOpencodeEvent {
  type: string;
  payload: unknown;
}

type Record_ = Record<string, unknown>;

function asRecord(value: unknown): Record_ | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record_) : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** v2 工具结果内容数组 -> 纯文本输出 */
function toolContentToText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const item of content) {
    const record = asRecord(item);
    if (!record) continue;
    if (typeof record.text === 'string') {
      parts.push(record.text);
    }
  }
  return parts.join('');
}

/**
 * 构造内部 messagePartUpdated 载荷（形状与 1.x 的 message.part.updated 对齐），
 * 使 stream-accumulator 无需改动即可消费。
 */
function partUpdated(
  sessionID: string,
  part: Record_,
  delta?: unknown
): InternalOpencodeEvent {
  return {
    type: 'messagePartUpdated',
    payload: {
      sessionID,
      part,
      ...(delta !== undefined ? { delta } : {}),
    },
  };
}

/**
 * 把单条 v2 事件映射为 0..N 条内部事件。
 * 未识别/无需处理的事件返回空数组（安全忽略）。
 */
export function mapV2Event(event: { type?: unknown; data?: unknown }): InternalOpencodeEvent[] {
  const type = str(event.type);
  const data = asRecord(event.data);
  if (!type || !data) {
    return [];
  }

  const sessionID = str(data.sessionID);

  switch (type) {
    case 'session.text.started':
    case 'session.text.delta':
    case 'session.text.ended': {
      if (!sessionID) return [];
      const messageID = str(data.assistantMessageID);
      const ordinal = typeof data.ordinal === 'number' ? data.ordinal : 0;
      const partId = `${messageID}:text:${ordinal}`;
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (!delta) return [];
      return [partUpdated(sessionID, {
        type: 'text',
        id: partId,
        messageID,
        sessionID,
      }, delta)];
    }

    case 'session.reasoning.started':
    case 'session.reasoning.delta':
    case 'session.reasoning.ended': {
      if (!sessionID) return [];
      const messageID = str(data.assistantMessageID);
      const ordinal = typeof data.ordinal === 'number' ? data.ordinal : 0;
      const partId = `${messageID}:reasoning:${ordinal}`;
      const delta = typeof data.delta === 'string'
        ? data.delta
        : typeof data.text === 'string' ? data.text : '';
      if (!delta) return [];
      return [partUpdated(sessionID, {
        type: 'reasoning',
        id: partId,
        messageID,
        sessionID,
      }, delta)];
    }

    case 'session.tool.input.started': {
      if (!sessionID) return [];
      const callId = str(data.id);
      return [partUpdated(sessionID, {
        type: 'tool',
        tool: str(data.name) || 'tool',
        callID: callId,
        messageID: str(data.assistantMessageID),
        sessionID,
        state: { status: 'running' },
      })];
    }

    case 'session.tool.input.ended': {
      if (!sessionID) return [];
      const callId = str(data.id);
      return [partUpdated(sessionID, {
        type: 'tool',
        tool: str(data.name) || 'tool',
        callID: callId,
        messageID: str(data.assistantMessageID),
        sessionID,
        state: { status: 'running', input: str(data.text) },
      })];
    }

    case 'session.tool.called': {
      if (!sessionID) return [];
      const callId = str(data.id);
      const input = data.input;
      return [partUpdated(sessionID, {
        type: 'tool',
        tool: str(data.name) || 'tool',
        callID: callId,
        messageID: str(data.assistantMessageID),
        sessionID,
        state: { status: 'running', input },
      })];
    }

    case 'session.tool.progress': {
      if (!sessionID) return [];
      const callId = str(data.id);
      return [partUpdated(sessionID, {
        type: 'tool',
        tool: str(data.name) || 'tool',
        callID: callId,
        messageID: str(data.assistantMessageID),
        sessionID,
        state: { status: 'running' },
      })];
    }

    case 'session.tool.success':
    case 'session.tool.failed': {
      if (!sessionID) return [];
      const callId = str(data.id);
      const output = toolContentToText(data.content) || str(data.error);
      const status = type === 'session.tool.success' ? 'completed' : 'failed';
      return [partUpdated(sessionID, {
        type: 'tool',
        tool: str(data.name) || 'tool',
        callID: callId,
        messageID: str(data.assistantMessageID),
        sessionID,
        state: { status, output },
      })];
    }

    case 'session.step.ended': {
      if (!sessionID) return [];
      const messageID = str(data.assistantMessageID);
      return [{
        type: 'messageUpdated',
        payload: {
          sessionID,
          info: {
            id: messageID,
            sessionID,
            time: { completed: Date.now() },
            cost: typeof data.cost === 'number' ? data.cost : undefined,
            tokens: data.tokens,
          },
        },
      }];
    }

    case 'session.execution.succeeded': {
      if (!sessionID) return [];
      return [{ type: 'sessionIdle', payload: { sessionID } }];
    }

    case 'session.execution.failed':
    case 'session.step.failed': {
      if (!sessionID) return [];
      const error = data.error;
      return [{ type: 'sessionError', payload: { sessionID, error } }];
    }

    case 'session.renamed': {
      if (!sessionID) return [];
      return [{
        type: 'messageUpdated',
        payload: { sessionID, info: { id: sessionID, sessionID, title: str(data.title) } },
      }];
    }

    case 'form.created': {
      const form = asRecord(data.form);
      if (!form) return [];
      const metadata = asRecord(form.metadata);
      if (!metadata || str(metadata.kind) !== 'question') return [];
      const formSessionID = str(form.sessionID);
      if (!formSessionID) return [];

      const fields = Array.isArray(form.fields) ? form.fields : [];
      const questions = fields.map((field) => {
        const record = asRecord(field) ?? {};
        const options = Array.isArray(record.options)
          ? record.options.map((option) => {
              const opt = asRecord(option) ?? {};
              return { label: str(opt.label) || str(opt.value), description: str(opt.description) };
            })
          : [];
        return {
          question: str(record.title),
          header: str(record.description) || str(record.title),
          options,
          multiple: str(record.type) === 'multiselect',
          custom: record.custom === true,
        };
      });

      return [{
        type: 'questionAsked',
        payload: {
          id: str(form.id),
          sessionID: formSessionID,
          questions,
          ...(metadata.tool ? { tool: metadata.tool } : {}),
        },
      }];
    }

    // v2 表单被回答/取消（可能来自 TUI / Web UI / 其他客户端，而非本桥接器）。
    // 映射成内部既有事件 questionReplied / questionRejected，复用
    // opencode-event-hub.handleQuestionResolved：它会移除飞书侧 pending 并
    // touch 输出缓冲触发卡片重渲染 —— 即「外部作答后飞书卡片同步」。
    // 非 question 类表单（如 MCP 授权）不在 questionHandler 注册表里，
    // handleQuestionResolved 查不到会安全 no-op。
    case 'form.replied': {
      const id = str(data.id);
      const sid = str(data.sessionID);
      if (!id || !sid) return [];
      return [{ type: 'questionReplied', payload: { requestID: id, sessionID: sid } }];
    }

    case 'form.cancelled': {
      const id = str(data.id);
      const sid = str(data.sessionID);
      if (!id || !sid) return [];
      return [{ type: 'questionRejected', payload: { requestID: id, sessionID: sid } }];
    }

    default:
      return [];
  }
}
