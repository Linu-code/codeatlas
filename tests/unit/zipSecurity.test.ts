import { describe, expect, it } from 'vitest';
import { sanitizeZipPath } from '../../src/sources/zipSecurity';
import { RepoError } from '../../src/types/repo';

/** ZIP 路径穿越防护是硬性安全约束，逐项覆盖攻击形态 */
describe('sanitizeZipPath', () => {
  it('合法相对路径正常规范化', () => {
    expect(sanitizeZipPath('src/index.ts')).toBe('src/index.ts');
    expect(sanitizeZipPath('./src/./a.ts')).toBe('src/a.ts');
    expect(sanitizeZipPath('src\\win\\path.ts')).toBe('src/win/path.ts'); // 反斜杠归一
  });

  it('拒绝 ../ 穿越（核心攻击面）', () => {
    for (const evil of [
      '../evil.sh',
      'a/../../evil.sh',
      '..\\..\\evil.exe',
      'foo/../../../../etc/passwd',
    ]) {
      expect(() => sanitizeZipPath(evil)).toThrow(RepoError);
      try {
        sanitizeZipPath(evil);
      } catch (e) {
        expect((e as RepoError).code).toBe('zip-insecure');
      }
    }
  });

  it('拒绝绝对路径、盘符与 UNC（含首部斜杠形态，策略从严）', () => {
    for (const evil of [
      '/leading/slash.txt',
      '//unc/share/f',
      'C:/windows/evil.dll',
      'C:\\temp\\x.txt',
      '\\\\server\\share\\f',
    ]) {
      expect(() => sanitizeZipPath(evil)).toThrow(RepoError);
    }
  });

  it('拒绝 Windows 保留设备名', () => {
    for (const evil of ['CON/setup.cfg', 'NUL.txt', 'com1/port.log']) {
      expect(() => sanitizeZipPath(evil)).toThrow(RepoError);
    }
  });

  /**
   * 记录一个**有意放行**的边界：NTFS 备用数据流（ADS）形态 `name:stream`。
   *
   * 不拒绝的两个理由：
   *   1. 本项目的 ZIP 内容只进内存 Map（`ZipSource` 从不落盘、不调用 fs），
   *      没有"写入被劫持到隐藏流"的攻击面；
   *   2. `:` 在 Linux/macOS 上是合法文件名字符，拒绝会让这类仓库（如
   *      `logs/access:2026.log`）整包打不开，属于误伤。
   *
   * 若将来新增"把 ZIP 解压到磁盘"的能力，必须先收紧这里。
   */
  it('放行含冒号的文件名（ADS 形态）—— 仅因内容不落盘，见上方说明', () => {
    expect(sanitizeZipPath('logs/access:2026.log')).toBe('logs/access:2026.log');
    expect(sanitizeZipPath('readme.md:secret')).toBe('readme.md:secret');
  });
});
