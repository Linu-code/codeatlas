/**
 * ZIP 路径安全校验（硬性约束：防路径穿越攻击）
 *
 * 攻击面：恶意 ZIP 条目可能携带 "../evil.sh"、"/etc/passwd"、"C:\\windows\\evil.dll"
 * 等路径，直接落盘或拼 URL 会逃逸项目根目录。策略：写入内存 Map 前逐条校验。
 *
 * 有意**不拦**的形态：NTFS 备用数据流 `name:stream`。理由见 sanitizeZipPath 内注释，
 * 对应测试 tests/unit/zipSecurity.test.ts 末例。
 */

import { RepoError } from '../types/repo';

/**
 * 校验并规范化 ZIP 条目路径。
 * 合法：返回 POSIX 风格相对路径（去首尾 '/'）。
 * 非法：抛 RepoError('zip-insecure')。
 */
export function sanitizeZipPath(rawPath: string): string {
  // 统一 POSIX 分隔符（Windows 打包工具常见反斜杠）
  let p = rawPath.replace(/\\/g, '/');

  // 绝对路径 / 盘符（Windows: C:/ 或 C:\）
  // 注意：UNC（\\server\share）经上一行归一为 //server/share，被这里的首斜杠分支拦下。
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) {
    throw new RepoError('zip-insecure', `absolute path in zip: ${rawPath}`);
  }

  // 逐段规范化，拒绝 ..
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue; // 空段与当前目录段直接丢弃
    if (seg === '..') {
      // 穿越：无论能否弹出栈都视为攻击（我们根本不打算让它逃逸）
      throw new RepoError('zip-insecure', `path traversal in zip: ${rawPath}`);
    }
    // Windows 保留设备名（NUL.txt 等带扩展名的形态也算保留名）
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..+)?$/i.test(seg)) {
      throw new RepoError('zip-insecure', `reserved device name in zip: ${rawPath}`);
    }
    // 含冒号的段（NTFS ADS 形态 name:stream）**刻意放行**：
    //   ① 本模块的产物只进内存 Map，ZipSource 从不落盘，没有"写入被劫持到隐藏流"的面；
    //   ② ':' 在 Linux/macOS 是合法文件名字符，拦掉会让此类仓库整包打不开（误伤）。
    // 若将来新增"解压到磁盘"的能力，必须在此处补一道拒绝规则。
    parts.push(seg);
  }

  p = parts.join('/');
  if (!p) throw new RepoError('zip-insecure', `empty path in zip: ${rawPath}`);
  return p;
}
