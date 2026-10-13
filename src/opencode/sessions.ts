import type { OpencodeClient as SdkOpencodeClient } from '@opencode-ai/sdk';
import type { Session, Project, Message, Part } from '@opencode-ai/sdk';
import type { SessionQueryOptions } from './client.js';
import { formatSdkError, appendAuthHint } from './client-helpers.js';
import { detectApiDialect } from './api-dialect.js';
import {
  createV2Session,
  deleteV2Session,
  getV2Session,
  getV2SessionDirectory,
  getV2SessionMessages,
  listV2Projects,
  listV2Sessions,
  updateV2Session,
  type V2SessionInfo,
} from './sessions-v2.js';

export interface SessionsDeps {
  getClient: () => SdkOpencodeClient | null;
  normalizeDirectory: (directory?: string) => string | undefined;
  rememberDirectory: (directory?: string) => string | undefined;
  ensureDirectoryEventStream: (directory: string) => Promise<void>;
  knownSessionDirectoriesRef: { current: Set<string> };
}

export class SessionsManager {
  constructor(private deps: SessionsDeps) {}

  // 获取客户端实例
  private getClient(): SdkOpencodeClient {
    const client = this.deps.getClient();
    if (!client) {
      throw new Error('OpenCode客户端未连接');
    }
    return client;
  }

  // 获取工作区列表
  async listProjects(options?: SessionQueryOptions): Promise<Project[]> {
    if ((await detectApiDialect()) === 'v2') {
      return (await listV2Projects()) as unknown as Project[];
    }
    const client = this.getClient();
    const directory = this.deps.normalizeDirectory(options?.directory);
    const result = await client.project.list(
      directory ? { query: { directory } } : undefined
    );
    return Array.isArray(result.data) ? result.data : [];
  }

  // 获取会话列表（可按目录过滤）
  async listSessions(options?: SessionQueryOptions): Promise<Session[]> {
    const directory = this.deps.rememberDirectory(options?.directory);

    if ((await detectApiDialect()) === 'v2') {
      const sessions = (await listV2Sessions()).map((s) => this.toSession(s));
      for (const session of sessions) {
        this.deps.rememberDirectory(session.directory);
      }
      return sessions;
    }

    const client = this.getClient();
    const result = await client.session.list(
      directory ? { query: { directory } } : undefined
    );
    const sessions = Array.isArray(result.data) ? result.data : [];
    for (const session of sessions) {
      this.deps.rememberDirectory(session.directory);
    }
    return sessions;
  }

  // 跨工作区聚合会话列表
  async listSessionsAcrossProjects(): Promise<Session[]> {
    const merged = new Map<string, Session>();
    const upsertSessions = (sessions: Session[]): void => {
      for (const session of sessions) {
        this.deps.rememberDirectory(session.directory);
        const existing = merged.get(session.id);
        if (!existing) {
          merged.set(session.id, session);
          continue;
        }

        const existingUpdated = existing.time?.updated ?? existing.time?.created ?? 0;
        const nextUpdated = session.time?.updated ?? session.time?.created ?? 0;
        if (nextUpdated >= existingUpdated) {
          merged.set(session.id, session);
        }
      }
    };

    try {
      upsertSessions(await this.listSessions());
    } catch (error) {
      console.warn('[OpenCode] 获取默认作用域会话列表失败:', error);
    }

    let directories: string[] = [];
    try {
      const projects = await this.listProjects();
      const seenDirectories = new Set<string>();
      for (const project of projects) {
        const normalized = this.deps.rememberDirectory(project.worktree);
        if (!normalized || seenDirectories.has(normalized)) {
          continue;
        }
        seenDirectories.add(normalized);
        directories.push(normalized);
      }

      for (const knownDirectory of this.deps.knownSessionDirectoriesRef.current) {
        if (seenDirectories.has(knownDirectory)) {
          continue;
        }
        seenDirectories.add(knownDirectory);
        directories.push(knownDirectory);
      }
    } catch (error) {
      console.warn('[OpenCode] 获取项目列表失败:', error);
      directories = Array.from(this.deps.knownSessionDirectoriesRef.current);
    }

    const sessionGroups = await Promise.all(
      directories.map(async directory => {
        try {
          return await this.listSessions({ directory });
        } catch (error) {
          console.warn(`[OpenCode] 获取目录会话列表失败: directory=${directory}`, error);
          return [] as Session[];
        }
      })
    );

    for (const sessions of sessionGroups) {
      upsertSessions(sessions);
    }

    return Array.from(merged.values());
  }

  // 聚合查询所有已知目录的 session（默认 Instance + 各自定义 directory Instance）
  async listAllSessions(knownDirectories: string[]): Promise<Session[]> {
    const allSessions: Session[] = [];
    const seen = new Set<string>();

    // 1. 默认 Instance
    try {
      const defaultSessions = await this.listSessions();
      for (const s of defaultSessions) {
        if (!seen.has(s.id)) { seen.add(s.id); allSessions.push(s); }
      }
    } catch {
      // 默认 Instance 查询失败不阻塞
    }

    // 2. 各自定义目录的 Instance
    for (const dir of knownDirectories) {
      try {
        const sessions = await this.listSessions({ directory: dir });
        for (const s of sessions) {
          if (!seen.has(s.id)) { seen.add(s.id); allSessions.push(s); }
        }
      } catch {
        // 单个目录查询失败不阻塞其他
      }
    }

    return allSessions;
  }

  // 通过 ID 获取会话（可按目录限定）
  async getSessionById(sessionId: string, options?: SessionQueryOptions): Promise<Session | null> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return null;
    }

    if ((await detectApiDialect()) === 'v2') {
      const session = await getV2Session(normalizedSessionId);
      if (!session) {
        return null;
      }
      const mapped = this.toSession(session);
      if (mapped.directory) {
        this.deps.rememberDirectory(mapped.directory);
      }
      return mapped;
    }

    const client = this.getClient();
    const directory = this.deps.rememberDirectory(options?.directory);
    const result = await client.session.get({
      path: { id: normalizedSessionId },
      ...(directory ? { query: { directory } } : {}),
    });

    if (result.error) {
      const statusCode = result.response?.status;
      if (statusCode === 404) {
        return null;
      }

      const detail = formatSdkError(result.error);
      const message = statusCode
        ? `获取会话失败（HTTP ${statusCode}）: ${detail}`
        : `获取会话失败: ${detail}`;
      throw new Error(appendAuthHint(message, statusCode));
    }

    if (result.data?.directory) {
      this.deps.rememberDirectory(result.data.directory);
    }

    return result.data || null;
  }

  // 跨工作区按 ID 查找会话
  async findSessionAcrossProjects(sessionId: string): Promise<Session | null> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return null;
    }

    const direct = await this.getSessionById(normalizedSessionId);
    if (direct) {
      return direct;
    }

    const projects = await this.listProjects();
    const directories: string[] = [];
    const seenDirectories = new Set<string>();
    for (const project of projects) {
      const normalized = this.deps.rememberDirectory(project.worktree);
      if (!normalized || seenDirectories.has(normalized)) {
        continue;
      }
      seenDirectories.add(normalized);
      directories.push(normalized);
    }

    for (const knownDirectory of this.deps.knownSessionDirectoriesRef.current) {
      if (seenDirectories.has(knownDirectory)) {
        continue;
      }
      seenDirectories.add(knownDirectory);
      directories.push(knownDirectory);
    }

    for (const directory of directories) {
      const found = await this.getSessionById(normalizedSessionId, { directory });
      if (found) {
        return found;
      }
    }

    return null;
  }

  // 获取或创建会话
  async getOrCreateSession(title?: string): Promise<Session> {
    if ((await detectApiDialect()) === 'v2') {
      const existing = await listV2Sessions();
      if (existing.length > 0) {
        return this.toSession(existing[0]);
      }
      const created = await createV2Session({ title: title || '飞书对话' });
      if (!created) {
        throw new Error('创建会话失败 (v2)');
      }
      return this.toSession(created);
    }

    const client = this.getClient();

    // 尝试获取现有会话列表
    const sessions = await client.session.list();

    // 如果有会话，返回最近的一个
    if (sessions.data && sessions.data.length > 0) {
      const latestSession = sessions.data[0];
      return latestSession;
    }

    // 创建新会话
    const newSession = await client.session.create({
      body: { title: title || '飞书对话' },
    });

    return newSession.data!;
  }

  // 创建新会话
  async createSession(title?: string, directory?: string): Promise<Session> {
    const normalizedDir = this.deps.rememberDirectory(directory);
    if (normalizedDir) {
      void this.deps.ensureDirectoryEventStream(normalizedDir);
    }

    if ((await detectApiDialect()) === 'v2') {
      const session = await createV2Session({
        title: title || '新对话',
        ...(normalizedDir ? { directory: normalizedDir } : {}),
      });
      if (!session) {
        throw new Error('创建会话失败 (v2)');
      }
      const mapped = this.toSession(session);
      if (mapped.directory) {
        this.deps.rememberDirectory(mapped.directory);
      }
      return mapped;
    }

    const client = this.getClient();
    const result = await client.session.create({
      body: { title: title || '新对话' },
      ...(normalizedDir ? { query: { directory: normalizedDir } } : {}),
    });
    if (result.data?.directory) {
      this.deps.rememberDirectory(result.data.directory);
    }
    return result.data!;
  }

  // 更新会话标题
  async updateSession(sessionId: string, title: string): Promise<boolean> {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      console.warn('[OpenCode] updateSession: 标题不能为空');
      return false;
    }

    if ((await detectApiDialect()) === 'v2') {
      return updateV2Session(sessionId, trimmedTitle);
    }

    const client = this.getClient();
    try {
      const result = await client.session.update({
        path: { id: sessionId },
        body: { title: trimmedTitle },
      });

      if (result.error) {
        const statusCode = result.response?.status;
        const detail = formatSdkError(result.error);
        const message = statusCode
          ? `会话重命名失败（HTTP ${statusCode}）: ${detail}`
          : `会话重命名失败: ${detail}`;
        console.error(`[OpenCode] ${appendAuthHint(message, statusCode)}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`[OpenCode] 更新会话标题失败: ${sessionId}`, error);
      return false;
    }
  }

  // 删除会话
  async deleteSession(sessionId: string, options?: SessionQueryOptions): Promise<boolean> {
    if ((await detectApiDialect()) === 'v2') {
      const ok = await deleteV2Session(sessionId);
      if (ok) {
        console.log(`[OpenCode] 已删除会话(v2): ${sessionId}`);
      }
      return ok;
    }

    const client = this.getClient();
    try {
      const directory = this.deps.normalizeDirectory(options?.directory);
      await client.session.delete({
        path: { id: sessionId },
        ...(directory ? { query: { directory } } : {}),
      });
      console.log(`[OpenCode] 已删除会话: ${sessionId}`);
      return true;
    } catch (error) {
      console.error(`[OpenCode] 删除会话失败: ${sessionId}`, error);
      return false;
    }
  }

  // 获取会话消息
  async getSessionMessages(sessionId: string): Promise<Array<{ info: Message; parts: Part[] }>> {
    if ((await detectApiDialect()) === 'v2') {
      return (await getV2SessionMessages(sessionId)) as unknown as Array<{ info: Message; parts: Part[] }>;
    }
    const client = this.getClient();
    const result = await client.session.messages({
      path: { id: sessionId },
    });
    return result.data || [];
  }

  private toSession(v2: V2SessionInfo): Session {
    const directory = getV2SessionDirectory(v2);
    return {
      ...v2,
      ...(directory ? { directory } : {}),
    } as unknown as Session;
  }

  async getSessionLastActivityTime(sessionId: string): Promise<number> {
    const messages = await this.getSessionMessages(sessionId);
    let latest = 0;

    for (const item of messages) {
      const info = item?.info as Record<string, unknown> | undefined;
      const time = info?.time;
      if (!time || typeof time !== 'object' || Array.isArray(time)) {
        continue;
      }

      for (const value of Object.values(time as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > latest) {
          latest = value;
        }
      }
    }

    return latest;
  }
}
