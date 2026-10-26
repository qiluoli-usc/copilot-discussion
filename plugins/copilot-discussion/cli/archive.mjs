import { gunzipSync } from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inside, safePath } from './storage.mjs';

export async function extractPackage(archive, destination) {
  const bytes = gunzipSync(archive, { maxOutputLength: 64 * 1024 * 1024 }), files = [], seen = new Set(); let pax = {};
  const text = value => value.toString('utf8').replace(/\0.*$/su, '');
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512); if (header.every(b => b === 0)) break;
    const expected = Number.parseInt(text(header.subarray(148, 156)).trim(), 8);
    let checksum = 0; for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (checksum !== expected) throw new Error('更新包目录校验失败。');
    const size = Number.parseInt(text(header.subarray(124, 136)).trim() || '0', 8), type = String.fromCharCode(header[156] || 48);
    if (!Number.isSafeInteger(size) || size < 0 || size > 8 * 1024 * 1024 || offset + 512 + size > bytes.length) throw new Error('更新包文件大小无效。');
    const content = bytes.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pax = {}; let at = 0;
      while (at < content.length) {
        const space = content.indexOf(32, at), length = Number(content.subarray(at, space).toString());
        if (space < at || !Number.isSafeInteger(length) || length <= space - at + 1 || at + length > content.length) throw new Error('更新包扩展目录无效。');
        const item = content.subarray(space + 1, at + length - 1).toString('utf8'), equal = item.indexOf('=');
        if (equal < 1 || content[at + length - 1] !== 10) throw new Error('更新包扩展目录无效。');
        pax[item.slice(0, equal)] = item.slice(equal + 1); at += length;
      }
      continue;
    }
    const prefix = text(header.subarray(345, 500)), name = pax.path || (prefix ? prefix + '/' : '') + text(header.subarray(0, 100)); pax = {};
    if (!['0', '5'].includes(type) || !name.startsWith('package/') || name.includes('\\') || name.includes(':') || name.split('/').includes('..') || name.split('/').includes('.')) throw new Error('更新包包含未知文件类型或越界路径。');
    const relative = name.slice(8).replace(/\/$/u, ''); if (!relative) continue;
    const target = path.resolve(destination, ...relative.split('/'));
    if (!inside(destination, target) || seen.has(relative.toLowerCase())) throw new Error('更新包路径重复或越界。');
    seen.add(relative.toLowerCase()); if (type === '0') files.push({ target, content });
  }
  await safePath(destination);
  if (await fs.stat(destination).then(() => true).catch(() => false)) throw new Error('更新解压目录必须为新目录。');
  await fs.mkdir(destination, { recursive: true });
  for (const file of files) { await fs.mkdir(path.dirname(file.target), { recursive: true }); await fs.writeFile(file.target, file.content, { flag: 'wx' }); }
  if (!files.some(f => f.target === path.join(destination, 'package.json'))) throw new Error('更新包缺少package.json。');
}
