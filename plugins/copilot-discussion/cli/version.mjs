export function compareVersions(a, b) {
  const parse = v => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z0-9.-]+))?$/u.exec(v);
    if (!match) throw new Error('版本号格式不正确。');
    return { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') };
  };
  const left = parse(a), right = parse(b);
  const cmp = (x, y) => x < y ? -1 : x > y ? 1 : 0;
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return cmp(left.core[i], right.core[i]);
  if (!left.pre || !right.pre) return left.pre ? -1 : right.pre ? 1 : 0;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/u.test(x), ny = /^\d+$/u.test(y);
    return nx && ny ? cmp(BigInt(x), BigInt(y)) : nx !== ny ? nx ? -1 : 1 : cmp(x, y);
  }
  return 0;
}
