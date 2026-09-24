import { chatSessionStore } from '../store/chat-session.js';
import { opencodeClient } from '../opencode/client.js';

// question 的 pending 表按 OpenCode location(InstanceState) 目录隔离：reply/reject
// 必须带上会话工作目录，否则会命中服务端默认 location 报 QuestionNotFoundError(404)。
// 优先使用调用方已解析的目录，缺失时回查会话列表补齐。
export async function resolveQuestionDirectory(
  sessionId: string,
  preferredDirectory?: string
): Promise<string | undefined> {
  if (preferredDirectory) {
    return preferredDirectory;
  }
  try {
    const sessions = await opencodeClient.listAllSessions(chatSessionStore.getKnownDirectories());
    return sessions.find((session) => session.id === sessionId)?.directory;
  } catch (error) {
    console.debug('[Question] 解析会话目录失败:', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}
