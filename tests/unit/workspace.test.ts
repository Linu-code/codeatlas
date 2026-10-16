/**
 * 单测：多项目工作区（N5③）
 *
 * Workspace 是纯逻辑 store（无 React / 无 DOM），因此可直接在 node 环境断言：
 * 空项目就地加载、追加标签、激活切换、关闭接管、订阅通知等核心语义。
 */

import { describe, expect, it } from 'vitest';
import { Workspace } from '../../src/workspace/workspace';

const gh = (owner: string, repo: string) => ({
  kind: 'github' as const,
  parsed: { owner, repo, branch: null, subDir: null },
});

describe('Workspace（多项目工作区）', () => {
  it('初始只有一个空项目且为激活项', () => {
    const ws = new Workspace();
    const s = ws.getSnapshot();
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0].source.kind).toBe('none');
    expect(s.activeId).toBe(s.projects[0].id);
    expect(ws.isActiveEmpty()).toBe(true);
  });

  it('空项目第一次打开 → 就地加载，不新增标签', () => {
    const ws = new Workspace();
    const id = ws.openGithub({ owner: 'a', repo: 'b', branch: null, subDir: null });
    const s = ws.getSnapshot();
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0].id).toBe(id);
    expect(s.projects[0].source).toEqual(gh('a', 'b'));
    expect(s.projects[0].loading).toBe(true);
    expect(ws.isActiveEmpty()).toBe(false); // 已不再是空项目（source 已切换）
  });

  it('已有项目时再打开 → 追加标签并激活', () => {
    const ws = new Workspace();
    const a = ws.openGithub({ owner: 'a', repo: 'b', branch: null, subDir: null });
    ws.report(a, { name: 'a/b', sourceKind: 'github', loading: false });
    const b = ws.openGithub({ owner: 'c', repo: 'd', branch: null, subDir: null });

    const s = ws.getSnapshot();
    expect(s.projects).toHaveLength(2);
    expect(s.activeId).toBe(b);
    expect(s.projects.map((p) => p.name)).toEqual(['a/b', null]);
    expect(s.projects[0].id).toBe(a);
  });

  it('加载中的项目不会被"就地加载"抢占（装载中再打开 → 新增标签）', () => {
    const ws = new Workspace();
    ws.openGithub({ owner: 'a', repo: 'b', branch: null, subDir: null }); // 尚在 loading，name 仍为 null
    const s2 = ws.openGithub({ owner: 'c', repo: 'd', branch: null, subDir: null });
    const s = ws.getSnapshot();
    expect(s.projects).toHaveLength(2);
    expect(s.activeId).toBe(s2);
  });

  it('report 更新标题 / 类型 / 加载态；值未变化时不通知', () => {
    const ws = new Workspace();
    const id = ws.getSnapshot().activeId;
    let calls = 0;
    ws.subscribe(() => {
      calls += 1;
    });

    ws.report(id, { name: 'x/y', sourceKind: 'github', loading: false });
    expect(calls).toBe(1);
    const snap = ws.getSnapshot();
    expect(snap.projects[0].name).toBe('x/y');
    expect(snap.projects[0].sourceKind).toBe('github');

    // 相同值再次 report → 不触发
    ws.report(id, { name: 'x/y', sourceKind: 'github', loading: false });
    expect(calls).toBe(1);

    // 变化 → 触发
    ws.report(id, { name: 'x/y', sourceKind: 'github', loading: true });
    expect(calls).toBe(2);
  });

  it('activate 切换激活项；无效 id 忽略', () => {
    const ws = new Workspace();
    const a = ws.openGithub({ owner: 'a', repo: 'b', branch: null, subDir: null });
    ws.report(a, { name: 'a/b', sourceKind: 'github', loading: false });
    const b = ws.openGithub({ owner: 'c', repo: 'd', branch: null, subDir: null });

    ws.activate(a);
    expect(ws.getSnapshot().activeId).toBe(a);
    ws.activate('nope');
    expect(ws.getSnapshot().activeId).toBe(a);
  });

  it('close 关闭并从相邻项接管激活；关最后一个则补一个空项目', () => {
    const ws = new Workspace();
    const a = ws.openGithub({ owner: 'a', repo: 'b', branch: null, subDir: null });
    ws.report(a, { name: 'a/b', sourceKind: 'github', loading: false });
    const b = ws.openGithub({ owner: 'c', repo: 'd', branch: null, subDir: null });
    ws.report(b, { name: 'c/d', sourceKind: 'github', loading: false });

    ws.activate(b);
    ws.close(b); // 关掉激活项（最后一个）→ 接管相邻（a）
    let s = ws.getSnapshot();
    expect(s.projects).toHaveLength(1);
    expect(s.activeId).toBe(a);

    ws.close(a); // 关掉最后一个 → 自动补一个空项目
    s = ws.getSnapshot();
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0].source.kind).toBe('none');
    expect(s.activeId).toBe(s.projects[0].id);
    expect(ws.isActiveEmpty()).toBe(true);
  });

  it('subscribe / 取消订阅', () => {
    const ws = new Workspace();
    let calls = 0;
    const off = ws.subscribe(() => {
      calls += 1;
    });
    ws.openGithub({ owner: 'a', repo: 'b', branch: null, subDir: null });
    expect(calls).toBe(1);
    off();
    ws.openGithub({ owner: 'c', repo: 'd', branch: null, subDir: null });
    expect(calls).toBe(1);
  });
});
