import { promises as fs } from 'node:fs';
import { restoreHostIntegration } from '../../product/plugins/copilot-discussion/skills/copilot-discussion/scripts/host-integration.mjs';
try {
  const request = JSON.parse((await fs.readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/u, ''));
  const result = await restoreHostIntegration({ journalFile: request.journalFile });
  process.stdout.write(JSON.stringify({ type: 'complete', result: { ...result, message: result.status === 'rolled-back' ? '本次宿主接入已撤销；重新加载宿主后生效。运行环境和研究记录保留。' : '存在安装后的用户改动，已保留；详情见本机回滚报告。' } }) + '\n');
} catch { process.stdout.write(JSON.stringify({ type: 'error', message: '撤销接入未完成。未覆盖用户修改，请保留本机报告。' }) + '\n'); process.exitCode = 1; }
