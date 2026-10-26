/**
 * OpenCode v2 / 模型提供方错误 → 中文可读说明 + 可执行建议
 *
 * 背景：v2 把会话历史转成 provider 格式发给模型时，provider 会返回各种校验类错误，
 * 桥接器之前把原始英文直接透传给用户（如 "invalid params, messages.647.content.0.
 * tool_use.input: Input should be a valid dictionary (2013)"），用户看不懂也不知道
 * 该怎么办。这里做一层归类翻译：给出「发生了什么 + 建议怎么做」。
 *
 * 设计原则：
 *  - 永远保留原始错误（截断后）作为兜底信息，不丢上下文；
 *  - 只翻译能确信的模式，匹配不上就走通用兜底；
 *  - 纯展示层，不改变任何请求/重试行为。
 */

export interface TranslatedError {
  /** 一句话说明发生了什么 */
  title: string;
  /** 补充细节（可选） */
  detail?: string;
  /** 用户可执行的建议 */
  hints: string[];
  /** 原始错误（截断） */
  raw: string;
}

const RAW_LIMIT = 400;

interface Rule {
  test: RegExp;
  build: (match: RegExpMatchArray, raw: string) => Omit<TranslatedError, 'raw'>;
}

const RULES: Rule[] = [
  {
    // MiniMax 等 provider 对 tool_use.input 的严格校验：
    // invalid params, messages.647.content.0.tool_use.input: Input should be a valid dictionary (2013)
    test: /tool_use\.input|Input should be a valid dictionary|invalid params.*tool_use/i,
    build: (_m, raw) => ({
      title: '会话历史与当前模型不兼容，这一轮请求被模型方拒绝了',
      detail:
        '模型在把本会话的历史转成它自己的格式时，发现某条「工具调用」记录格式不合法（tool_use.input 不是对象）。' +
        '历史本身没坏，是当前模型（及其服务端）对工具调用格式的校验比别的模型严。',
      hints: [
        '用 /model 换成别的模型重试（如 deepseek / opencode-go），通常即可绕过',
        '或用 /new 新建会话——历史里那条不兼容的记录就不会再被带上',
      ],
      raw,
    }),
  },
  {
    // v1 时期（OMO 插件）定义的角色在 v2 里不存在
    test: /Agent not found[:\s]+"?([^"\n]+?)"?\s*$/i,
    build: (m, raw) => ({
      title: `会话使用的角色「${(m[1] || '').trim()}」在 OpenCode v2 中已不存在`,
      detail:
        'OpenCode v2 只提供内置角色（Build / General / Explore 等）。这个角色是 v1 时期由 OMO 插件定义的，' +
        'v2 迁移后插件不再加载，历史里仍指向旧角色，导致会话无法继续。',
      hints: [
        '用 /new 新建会话，并在新会话里选择当前可用的角色',
        '或用 /model 切到可用角色后再试',
      ],
      raw,
    }),
  },
  {
    test: /QuotaExceeded|Free usage limit reached|insufficient.*(balance|quota)|额度/i,
    build: (_m, raw) => ({
      title: '模型额度已用尽',
      detail: '当前模型/订阅的额度已耗尽，OpenCode 无法继续调用模型。',
      hints: ['等待额度周期重置', '或用 /model 换一个有额度的模型 / provider'],
      raw,
    }),
  },
  {
    test: /UNKNOWN_CERTIFICATE_VERIFICATION_ERROR|CERTIFICATE_VERIFY|self.signed certificate|unable to verify/i,
    build: (_m, raw) => ({
      title: '与模型服务的 HTTPS 证书校验失败',
      detail: '连接模型服务时证书校验没通过，常见原因：系统时间不对、系统 CA 证书过旧、或中间代理改写了证书。',
      hints: ['检查系统时间是否准确', '更新系统 CA 证书', '若经过代理，确认代理没有做证书改写'],
      raw,
    }),
  },
  {
    test: /getaddrinfo (ETIMEOUT|ENOTFOUND|EAI_AGAIN)|ECONNREFUSED|ECONNRESET|ETIMEDOUT|AI\.Error\.Transport|fetch failed/i,
    build: (_m, raw) => ({
      title: '连不上模型服务（网络问题）',
      detail: 'OpenCode 请求模型接口时网络层失败了：DNS 解析超时 / 连接被拒 / 连接被重置。',
      hints: ['检查网络与代理（WSL 里注意代理是否需要单独设置）', '稍后重试，或用 /model 换一个线路不同的 provider'],
      raw,
    }),
  },
  {
    test: /Unauthorized|401|invalid[_ -]?api[_ -]?key|authentication/i,
    build: (_m, raw) => ({
      title: '模型鉴权失败',
      detail: '当前使用的 API key 无效、过期或没有该模型的权限。',
      hints: ['在 OpenCode 里重新登录该 provider（/login）', '或用 /model 换一个已登录的模型'],
      raw,
    }),
  },
  {
    test: /model[-_ ]not[-_ ]found|unknown model|no such model/i,
    build: (_m, raw) => ({
      title: '当前模型不可用',
      detail: '这个模型在当前 provider 下已经不存在或被下架了。',
      hints: ['用 /model 查看可用模型并切换', '用 /new 新建会话可避开历史里已失效的模型'],
      raw,
    }),
  },
];

function clipRaw(raw: string): string {
  const text = (raw || '').trim();
  if (text.length <= RAW_LIMIT) {
    return text;
  }
  return `${text.slice(0, RAW_LIMIT)}…（已截断，共 ${text.length} 字）`;
}

/**
 * 把原始错误翻译成可读说明。无法识别时返回通用兜底结构。
 */
export function translateOpenCodeError(raw: unknown): TranslatedError {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const clipped = clipRaw(text);

  if (!clipped) {
    return {
      title: '执行失败',
      hints: ['查看上方日志获取详情'],
      raw: '(无错误详情)',
    };
  }

  for (const rule of RULES) {
    const match = clipped.match(rule.test);
    if (match) {
      const built = rule.build(match, clipped);
      return { ...built, raw: clipped };
    }
  }

  return {
    title: '执行失败',
    detail: '未能识别该错误的类型，下面是原始信息。',
    hints: ['如反复出现，可用 /new 新建会话重置上下文', '查看上方日志获取完整调用栈'],
    raw: clipped,
  };
}

/**
 * 生成可直接放进卡片的错误文本（中文说明 + 建议 + 原始错误）。
 */
export function formatTranslatedError(raw: unknown): string {
  const t = translateOpenCodeError(raw);
  const lines: string[] = [`❌ ${t.title}`];
  if (t.detail) {
    lines.push(t.detail);
  }
  if (t.hints.length > 0) {
    lines.push('');
    lines.push('建议：');
    t.hints.forEach((hint, index) => lines.push(`${index + 1}. ${hint}`));
  }
  lines.push('');
  lines.push(`原始错误：${t.raw}`);
  return lines.join('\n');
}
