/**
 * 路径判定的单一来源。
 *
 * 「是不是测试/示例」在焦点检索（降权）与模块地图（排后）里都要用；
 * 写两遍必然走样——项目里已经吃过 7 次"同一份清单抄两遍"的亏。
 */

const TEST_PATH_RE =
  /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e|fixtures?|examples?|benchmarks?)\/|\.(test|spec|bench)\.[a-z]+$/i;

/** 是否属于测试 / 示例 / 基准目录（命中时应降低优先级，而不是排除） */
export function isTestPath(file: string): boolean {
  return TEST_PATH_RE.test(file);
}
