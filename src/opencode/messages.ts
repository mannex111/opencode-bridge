import type { OpencodeClient as SdkOpencodeClient } from '@opencode-ai/sdk';
import type { Message, Part } from '@opencode-ai/sdk';
import type { DirectoryResponseOptions, PermissionResponseOptions, QuestionResponseOptions, ShellExecutionResult } from './client.js';
import { opencodeConfig, modelConfig } from '../config.js';
import {
  withOpencodeAuthorizationHeaders,
  appendAuthHint,
  formatSdkError,
  inlineLocalUploadParts,
} from './client-helpers.js';

export interface MessagesDeps {
  getClient: () => SdkOpencodeClient | null;
  ensureDirectoryEventStream: (directory: string) => Promise<void>;
  normalizeDirectory: (directory?: string) => string | undefined;
}

export class MessagesManager {
  constructor(private deps: MessagesDeps) {}

  // 获取客户端实例
  private getClient(): SdkOpencodeClient {
    const client = this.deps.getClient();
    if (!client) {
      throw new Error('OpenCode客户端未连接');
    }
    return client;
  }

  private resolveModelOption(options?: { providerId?: string; modelId?: string }): { providerID: string; modelID: string } | undefined {
    const providerId = options?.providerId?.trim();
    const modelId = options?.modelId?.trim();
    if (providerId && modelId) {
      return {
        providerID: providerId,
        modelID: modelId,
      };
    }

    const defaultProvider = modelConfig.defaultProvider;
    const defaultModel = modelConfig.defaultModel;
    if (defaultProvider && defaultModel) {
      return {
        providerID: defaultProvider,
        modelID: defaultModel,
      };
    }

    return undefined;
  }

  // 发送消息并等待响应
  async sendMessage(
    sessionId: string,
    text: string,
    options?: {
      providerId?: string;
      modelId?: string;
      agent?: string;
      variant?: string;
      directory?: string;
    }
  ): Promise<{ info: Message; parts: Part[] }> {
    const client = this.getClient();
    const model = this.resolveModelOption(options);

    if (options?.directory) {
      void this.deps.ensureDirectoryEventStream(options.directory);
    }

      const response = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text }],
          ...(options?.agent ? { agent: options.agent } : {}),
          ...(model ? { model } : {}),
          ...(options?.variant ? { variant: options.variant } : {}),
        },
      ...(options?.directory ? { query: { directory: options.directory } } : {}),
      });

    return response.data as { info: Message; parts: Part[] };
  }

  // 发送带多类型 parts 的消息
  async sendMessageParts(
    sessionId: string,
    parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>,
    options?: {
      providerId?: string;
      modelId?: string;
      agent?: string;
      variant?: string;
      directory?: string;
    },
    messageId?: string
  ): Promise<{ info: Message; parts: Part[] }> {
    const client = this.getClient();
    const model = this.resolveModelOption(options);
    const resolvedParts = await inlineLocalUploadParts(parts);

    if (options?.directory) {
      void this.deps.ensureDirectoryEventStream(options.directory);
    }

      const response = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: resolvedParts,
          // ...(messageId ? { messageID: messageId } : {}), // 已注释：避免传递飞书 MessageID 导致 Opencode 无法处理
          ...(options?.agent ? { agent: options.agent } : {}),
          ...(model ? { model } : {}),
          ...(options?.variant ? { variant: options.variant } : {}),
        },
      ...(options?.directory ? { query: { directory: options.directory } } : {}),
      });

    return response.data as { info: Message; parts: Part[] };
  }

  // 异步发送消息（不等待响应）
  async sendMessageAsync(
    sessionId: string,
    text: string,
    options?: {
      providerId?: string;
      modelId?: string;
      agent?: string;
      variant?: string;
      directory?: string;
    }
  ): Promise<void> {
    this.getClient();
    const model = this.resolveModelOption(options);

    if (options?.directory) {
      void this.deps.ensureDirectoryEventStream(options.directory);
    }

    const dirQuery = options?.directory ? `?directory=${encodeURIComponent(options.directory)}` : '';
    const response = await fetch(`${opencodeConfig.baseUrl}/session/${sessionId}/prompt_async${dirQuery}`, {
      method: 'POST',
      headers: withOpencodeAuthorizationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        parts: [{ type: 'text', text }],
        ...(options?.agent ? { agent: options.agent } : {}),
        ...(model ? { model } : {}),
        ...(options?.variant ? { variant: options.variant } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
      const message = `prompt_async 请求失败 (${response.status} ${response.statusText})${suffix}`;
      throw new Error(appendAuthHint(message, response.status));
    }
  }

  // 异步发送多 parts 消息（立即返回，结果通过事件流推送）
  async sendMessagePartsAsync(
    sessionId: string,
    parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>,
    options?: {
      providerId?: string;
      modelId?: string;
      agent?: string;
      variant?: string;
      directory?: string;
    }
  ): Promise<void> {
    this.getClient();
    const model = this.resolveModelOption(options);
    const resolvedParts = await inlineLocalUploadParts(parts);

    if (options?.directory) {
      void this.deps.ensureDirectoryEventStream(options.directory);
    }

    const dirQuery = options?.directory ? `?directory=${encodeURIComponent(options.directory)}` : '';
    const response = await fetch(`${opencodeConfig.baseUrl}/session/${sessionId}/prompt_async${dirQuery}`, {
      method: 'POST',
      headers: withOpencodeAuthorizationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        parts: resolvedParts,
        ...(options?.agent ? { agent: options.agent } : {}),
        ...(model ? { model } : {}),
        ...(options?.variant ? { variant: options.variant } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
      const message = `prompt_async 请求失败 (${response.status} ${response.statusText})${suffix}`;
      throw new Error(appendAuthHint(message, response.status));
    }
  }

  // 发送命令
  async sendCommand(
    sessionId: string,
    command: string,
    args: string,
    options?: { directory?: string }
  ): Promise<{ info: Message; parts: Part[] }> {
    const client = this.getClient();

    if (options?.directory) {
      void this.deps.ensureDirectoryEventStream(options.directory);
    }

      const result = await client.session.command({
        path: { id: sessionId },
        body: {
          command,
          arguments: args,
        },
      ...(options?.directory ? { query: { directory: options.directory } } : {}),
      });

    if (result.error) {
      const statusCode = result.response?.status;
      const detail = formatSdkError(result.error);
      const message = statusCode
        ? `OpenCode 命令调用失败（HTTP ${statusCode}）: ${detail}`
        : `OpenCode 命令调用失败: ${detail}`;
      throw new Error(appendAuthHint(message, statusCode));
    }

    return result.data as { info: Message; parts: Part[] };
  }

  async sendShellCommand(
    sessionId: string,
    command: string,
    agent: string,
    options?: { providerId?: string; modelId?: string; directory?: string }
  ): Promise<ShellExecutionResult> {
    this.getClient();

    if (options?.directory) {
      void this.deps.ensureDirectoryEventStream(options.directory);
    }

    const model = options?.providerId && options?.modelId
      ? {
          providerID: options.providerId,
          modelID: options.modelId,
        }
      : undefined;

    const dirQuery = options?.directory ? `?directory=${encodeURIComponent(options.directory)}` : '';
    const response = await fetch(`${opencodeConfig.baseUrl}/session/${sessionId}/shell${dirQuery}`, {
      method: 'POST',
      headers: withOpencodeAuthorizationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        agent,
        command,
        ...(model ? { model } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const suffix = detail ? `: ${detail.slice(0, 500)}` : '';
      const message = `OpenCode Shell 调用失败（HTTP ${response.status} ${response.statusText}）${suffix}`;
      throw new Error(appendAuthHint(message, response.status));
    }

    const payload = await response.json().catch(() => null) as unknown;
    if (!payload || typeof payload !== 'object') {
      return { parts: [] };
    }

    const record = payload as Record<string, unknown>;
    const parts = Array.isArray(record.parts) ? record.parts as Part[] : [];

    if (record.info && typeof record.info === 'object') {
      return {
        info: record.info as Message,
        parts,
      };
    }

    if (typeof record.id === 'string' && typeof record.sessionID === 'string') {
      return {
        info: record as unknown as Message,
        parts,
      };
    }

    return { parts };
  }

  async summarizeSession(sessionId: string, providerId: string, modelId: string): Promise<boolean> {
    const client = this.getClient();
    const result = await client.session.summarize({
      path: { id: sessionId },
      body: {
        providerID: providerId,
        modelID: modelId,
      },
    });

    if (result.error) {
      const statusCode = result.response?.status;
      const detail = formatSdkError(result.error);
      const message = statusCode
        ? `会话压缩失败（HTTP ${statusCode}）: ${detail}`
        : `会话压缩失败: ${detail}`;
      throw new Error(appendAuthHint(message, statusCode));
    }

    return result.data === true;
  }

  // 撤回消息
  async revertMessage(sessionId: string, messageId: string): Promise<boolean> {
    const client = this.getClient();
    try {
      const result = await client.session.revert({
        path: { id: sessionId },
        body: { messageID: messageId },
      });
      return Boolean(result.data);
    } catch (error) {
      console.error('[OpenCode] 撤回消息失败:', error);
      return false;
    }
  }

  // 中断会话执行
  async abortSession(sessionId: string): Promise<boolean> {
    const client = this.getClient();

    try {
      const result = await client.session.abort({
        path: { id: sessionId },
      });
      return result.data === true;
    } catch (error) {
      console.error('[OpenCode] 中断会话失败:', error);
      return false;
    }
  }

  private buildDirectoryCandidates(options?: DirectoryResponseOptions): Array<string | undefined> {
    const candidates: Array<string | undefined> = [];
    const seen = new Set<string>();

    const pushDirectory = (directory?: string): void => {
      const normalized = this.deps.normalizeDirectory(directory);
      if (!normalized) {
        if (!seen.has('__default__')) {
          seen.add('__default__');
          candidates.push(undefined);
        }
        return;
      }

      const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      candidates.push(normalized);
    };

    pushDirectory(options?.directory);

    if (Array.isArray(options?.fallbackDirectories)) {
      for (const directory of options!.fallbackDirectories) {
        pushDirectory(directory);
      }
    }

    pushDirectory(undefined);

    return candidates;
  }

  // 响应权限请求
  async respondToPermission(
    sessionId: string,
    permissionId: string,
    allow: boolean,
    remember: boolean = false,
    options?: PermissionResponseOptions
  ): Promise<{ ok: boolean; expired?: boolean }> {
    const responseType = allow ? (remember ? 'always' : 'once') : 'reject';
    const directoryCandidates = this.buildDirectoryCandidates(options);

    for (const directory of directoryCandidates) {
      try {
        // 注：原代码用老路径 /session/{sid}/permissions/{pid} 已工作（实测
        // 老路径与新路径 /api/session/{sid}/permission/{rid}/reply 都 200/404
        // 同源响应），路径切换不是权限过期 404 的原因。保留老路径，但响应体
        // body 现在会打出来供诊断。
        const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
        const response = await fetch(
          `${opencodeConfig.baseUrl}/session/${sessionId}/permissions/${permissionId}${query}`,
          {
            method: 'POST',
            headers: withOpencodeAuthorizationHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              response: responseType,
            }),
          }
        );

        if (response.ok) {
          return { ok: true };
        }

        // 404 不再一律当过期，把服务端真实错误体打出来供诊断
        if (response.status === 404) {
          const detail = await response.text().catch(() => '');
          console.warn(`[OpenCode] 权限回复 404: session=${sessionId}, permission=${permissionId}, body=${detail.slice(0, 200)}`);
          return { ok: false, expired: true };
        }

        const detail = await response.text().catch(() => '');
        const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
        const message = appendAuthHint(
          `权限响应失败（HTTP ${response.status} ${response.statusText}）${suffix}`,
          response.status
        );
        const directoryLabel = directory ? `directory=${directory}` : 'directory=<default>';
        console.error(`[OpenCode] ${message} (${directoryLabel})`);
      } catch (error) {
        const directoryLabel = directory ? `directory=${directory}` : 'directory=<default>';
        console.error(`[OpenCode] 响应权限失败 (${directoryLabel}):`, error);
      }
    }

    return { ok: false };
  }

  private async listPendingQuestionIds(directory?: string): Promise<string[] | null> {
    try {
      const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
      const response = await fetch(`${opencodeConfig.baseUrl}/question${query}`, {
        method: 'GET',
        headers: withOpencodeAuthorizationHeaders(),
      });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json().catch(() => null);
      if (!Array.isArray(payload)) {
        return null;
      }
      return payload
        .map((item) => {
          const record = item as Record<string, unknown> | null;
          return record && typeof record.id === 'string' ? record.id : null;
        })
        .filter((id): id is string => Boolean(id));
    } catch (error) {
      console.debug('[OpenCode] 查询 pending question 失败:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  // question 的 reply/reject 作用于按目录隔离的 InstanceState pending 表
  // （OpenCode packages/opencode/src/question/index.ts）。必须带上会话所属
  // directory，否则会命中服务端默认 location 报 QuestionNotFoundError(404)——
  // 这正是「飞书作答同步失败」的根因。404 时再用 /question 列表兜底区分
  // 「命中错误实例/上游竞态」与「真的已过期」。
  private async dispatchQuestionAction(
    action: 'reply' | 'reject',
    requestId: string,
    sessionID: string,
    options?: QuestionResponseOptions,
    answers?: string[][]
  ): Promise<{ ok: boolean; expired?: boolean }> {
    const directoryCandidates = this.buildDirectoryCandidates(options);
    const actionLabel = action === 'reply' ? '回复问题' : '拒绝问题';

    const attempt = async (): Promise<boolean> => {
      for (const directory of directoryCandidates) {
        const directoryLabel = directory ?? '<default>';
        try {
          const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
          const response = await fetch(
            `${opencodeConfig.baseUrl}/question/${requestId}/${action}${query}`,
            {
              method: 'POST',
              headers: withOpencodeAuthorizationHeaders({ 'Content-Type': 'application/json' }),
              ...(action === 'reply' ? { body: JSON.stringify({ answers: answers ?? [] }) } : {}),
            }
          );

          if (response.ok) {
            return true;
          }

          const detail = await response.text().catch(() => '');
          if (response.status === 404) {
            console.warn(
              `[OpenCode] 问题${action === 'reply' ? '回复' : '拒绝'} 404: session=${sessionID}, requestId=${requestId}, directory=${directoryLabel}, body=${detail.slice(0, 200)}`
            );
            continue;
          }

          const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
          console.error(
            `[OpenCode] ${appendAuthHint(`${actionLabel}失败（HTTP ${response.status} ${response.statusText}）${suffix}`, response.status)} (directory=${directoryLabel})`
          );
        } catch (error) {
          console.error(`[OpenCode] ${actionLabel}失败 (directory=${directoryLabel}):`, error);
        }
      }
      return false;
    };

    if (await attempt()) {
      return { ok: true };
    }

    const pendingIds = await this.listPendingQuestionIds(options?.directory);
    if (pendingIds && pendingIds.includes(requestId)) {
      console.warn(`[OpenCode] question ${requestId} 仍在 pending，重试一次 ${action}`);
      if (await attempt()) {
        return { ok: true };
      }
      return { ok: false };
    }

    return { ok: false, expired: true };
  }

  // answers: [[第一题的答案们], [第二题的答案们], ...]，每项为选中选项的 label
  async replyQuestion(
    sessionID: string,
    requestId: string,
    answers: string[][],
    options?: QuestionResponseOptions
  ): Promise<{ ok: boolean; expired?: boolean }> {
    return this.dispatchQuestionAction('reply', requestId, sessionID, options, answers);
  }

  async rejectQuestion(
    sessionID: string,
    requestId: string,
    options?: QuestionResponseOptions
  ): Promise<{ ok: boolean; expired?: boolean }> {
    return this.dispatchQuestionAction('reject', requestId, sessionID, options);
  }
}
