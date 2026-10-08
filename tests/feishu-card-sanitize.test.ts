import { describe, expect, it } from 'vitest';
import { sanitizeCardImageSyntax, sanitizeCardPayload } from '../src/feishu/client-utils.js';

describe('sanitizeCardImageSyntax', () => {
  it('把空 alt 的图片语法 ![](key) 转成纯文本（渲染验证 案例）', () => {
    expect(sanitizeCardImageSyntax('![](渲染验证)')).toBe('🖼️ 渲染验证');
  });

  it('把带 alt 的图片语法转成纯文本', () => {
    expect(sanitizeCardImageSyntax('![图示](img_abc123)')).toBe('🖼️ 图示');
  });

  it('保留图片语法周围的文本', () => {
    expect(sanitizeCardImageSyntax('前\n![](渲染验证)\n后')).toBe('前\n🖼️ 渲染验证\n后');
  });

  it('剥离 <img> / <image> 标签', () => {
    expect(sanitizeCardImageSyntax('a<img src="x.png">b')).toBe('ab');
    expect(sanitizeCardImageSyntax('a<image key="渲染验证"/>b')).toBe('ab');
  });

  it('无图片语法的文本保持不变', () => {
    expect(sanitizeCardImageSyntax('正常文本 [链接](https://x) 结束')).toBe('正常文本 [链接](https://x) 结束');
  });

  it('空字符串安全返回', () => {
    expect(sanitizeCardImageSyntax('')).toBe('');
  });
});

describe('sanitizeCardPayload', () => {
  it('深扫 markdown / lark_md 节点并转义图片语法，其它节点不动', () => {
    const card = {
      header: { title: { tag: 'plain_text', content: '![](不应改)' } },
      body: {
        elements: [
          { tag: 'markdown', content: '![](渲染验证)' },
          { tag: 'lark_md', content: '![x](img_bad)' },
          { tag: 'plain_text', content: '![](原样)' },
          { tag: 'collapsible_panel', elements: [{ tag: 'markdown', content: '嵌套 ![](k)' }] },
        ],
      },
    };

    const out = sanitizeCardPayload(card) as typeof card;

    expect(out.body.elements[0]).toMatchObject({ tag: 'markdown', content: '🖼️ 渲染验证' });
    expect(out.body.elements[1]).toMatchObject({ tag: 'lark_md', content: '🖼️ x' });
    expect(out.body.elements[2]).toMatchObject({ tag: 'plain_text', content: '![](原样)' });
    expect(out.body.elements[3]).toMatchObject({
      tag: 'collapsible_panel',
      elements: [{ tag: 'markdown', content: '嵌套 🖼️ k' }],
    });
  });

  it('不修改原始卡片对象', () => {
    const card = { body: { elements: [{ tag: 'markdown', content: '![](渲染验证)' }] } };
    sanitizeCardPayload(card);
    expect(card.body.elements[0].content).toBe('![](渲染验证)');
  });
});
