import { loadSettings } from '../../product/plugins/copilot-discussion/skills/copilot-discussion/scripts/settings.mjs';
import { JevNativeTransport } from '../../product/plugins/copilot-discussion/skills/copilot-discussion/scripts/jev-native.mjs';
try {
  const settings = loadSettings({ configFile: process.argv[2] });
  const transport = await JevNativeTransport.launch({ runtimeRoot: settings.native.runtimeRoot, pythonExecutable: settings.native.pythonExecutable, launcher: settings.native.pythonLauncher, cdpUrl: settings.native.cdpUrl });
  await transport.dispose();
  console.log(JSON.stringify({ type: 'complete', result: { ready: true, message: 'Jev Native 已连接 Chrome。Microsoft 登录仍需在 Copilot 网页中完成。' } }));
} catch {
  console.log(JSON.stringify({ type: 'error', message: 'Chrome 未就绪。请在 Chrome 启用远程调试、批准 Allow，然后重试授权检查。' }));
  process.exitCode = 1;
}
