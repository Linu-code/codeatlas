/**
 * 单测：工作区持久化的序列化与校验
 *
 * 只测纯函数（serializeWorkspace / isValidSaved），localStorage 读写靠 E2E 覆盖。
 */

import { describe, expect, it } from 'vitest';
import { isValidSaved, serializeWorkspace } from '../../src/workspace/persistence';
import type { ProjectEntry } from '../../src/workspace/workspace';

function entry(id: string, source: ProjectEntry['source']): ProjectEntry {
  return { id, source, name: null, sourceKind: null, loading: false };
}

describe('serializeWorkspace', () => {
  it('只保留 github / local，跳过 zip 与空项目', () => {
    const projects: ProjectEntry[] = [
      entry('a', { kind: 'zip', file: {} as File }),
      entry('b', {
        kind: 'github',
        parsed: { owner: 'o', repo: 'r', branch: 'main', subDir: null },
      }),
      entry('c', { kind: 'none' }),
      entry('d', { kind: 'local', rootPath: 'C:/x' }),
    ];
    const saved = serializeWorkspace(projects, 'd');
    expect(saved.projects.map((p) => p.kind)).toEqual(['github', 'local']);
    expect(saved.activeIndex).toBe(1);
  });

  it('激活项不可持久化时 activeIndex 归 0', () => {
    const projects: ProjectEntry[] = [
      entry('a', {
        kind: 'github',
        parsed: { owner: 'o', repo: 'r', branch: null, subDir: null },
      }),
      entry('b', { kind: 'zipBytes', bytes: new Uint8Array(), name: 'x.zip' }),
    ];
    const saved = serializeWorkspace(projects, 'b');
    expect(saved.projects).toHaveLength(1);
    expect(saved.activeIndex).toBe(0);
  });

  it('全空时返回空列表', () => {
    expect(serializeWorkspace([entry('a', { kind: 'none' })], 'a')).toEqual({
      projects: [],
      activeIndex: 0,
    });
  });
});

describe('isValidSaved', () => {
  it('接受合法结构', () => {
    expect(
      isValidSaved({
        projects: [
          { kind: 'github', parsed: { owner: 'o', repo: 'r', branch: null, subDir: null } },
          { kind: 'local', rootPath: 'C:/x' },
        ],
        activeIndex: 1,
      }),
    ).toBe(true);
  });

  it('拒绝未知 kind / 缺字段 / 非法 activeIndex', () => {
    expect(isValidSaved(null)).toBe(false);
    expect(isValidSaved({ projects: [], activeIndex: 0 })).toBe(true); // 空列表合法
    expect(isValidSaved({ projects: [{ kind: 'zip' }], activeIndex: 0 })).toBe(false);
    expect(isValidSaved({ projects: [{ kind: 'local' }], activeIndex: 0 })).toBe(false);
    expect(isValidSaved({ projects: [{ kind: 'github', parsed: { owner: '' } }], activeIndex: 0 })).toBe(
      false,
    );
    expect(isValidSaved({ projects: [], activeIndex: 'x' })).toBe(false);
    expect(isValidSaved({ projects: [] })).toBe(false);
  });
});
