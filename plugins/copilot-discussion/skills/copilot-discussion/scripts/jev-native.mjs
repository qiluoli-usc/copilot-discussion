import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVisibleConversation } from './copilot.mjs';
import { loadSettings } from './settings.mjs';

export const NATIVE_BROWSER_ID = 'jev-native';
export const defaultRuntime = () => loadSettings().native.runtimeRoot;

export class JevNativeTransport {
  constructor(child, { timeoutMs = 45000 } = {}) {
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.requests = new Map();
    this.binding = null;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    const lines = createInterface({ input: child.stdout });
    this.lines = lines;
    lines.on('line', line => {
      let response;
      try { response = JSON.parse(line); } catch { return; }
      if ('ready' in response) {
        if (response.ready && response.protocol === 1) this.readyResolve(response);
        else this.readyReject(new Error(response.error || 'Native worker protocol mismatch.'));
        return;
      }
      if (response.decisionStats) this.decisionStats = response.decisionStats;
      const request = this.requests.get(response.id);
      if (!request) return;
      clearTimeout(request.timer); this.requests.delete(response.id);
      if (response.ok) request.resolve(response.result);
      else {
        const error = new Error(`${response.error || 'Native operation failed.'} (${response.errorType || 'unknown'})`);
        error.nativeErrorType = response.errorType;
        request.reject(error);
      }
    });
    // Dependency diagnostics can contain request data. Do not echo stderr.
    child.stderr.on('data', () => {});
    const ended = code => {
      const error = new Error(`Jev Native worker stopped (${code ?? 'spawn error'}); inspect before retrying.`);
      this.readyReject(error);
      for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(error); }
      this.requests.clear();
    };
    child.on('error', () => ended(null)); child.on('exit', ended);
  }

  static async launch({ runtimeRoot, fixtureOrigin, timeoutMs = 45000, launcher, pythonExecutable, cdpUrl, workerFile, decision } = {}) {
    const configured = runtimeRoot && (launcher || pythonExecutable) && cdpUrl ? {} : loadSettings().native;
    runtimeRoot ||= configured.runtimeRoot;
    launcher ||= configured.pythonLauncher;
    pythonExecutable ||= configured.pythonExecutable;
    cdpUrl ||= configured.cdpUrl;
    if (!runtimeRoot || !path.isAbsolute(runtimeRoot)) throw new Error('请先用 setup.mjs 配置 Jev runtimeRoot 或设置 JEV_ULTRAFAST_ROOT。');
    if (process.platform !== 'win32') throw new Error('当前 Jev Native 适配只支持 Windows 本机 Chrome。');
    const worker = workerFile || fileURLToPath(new URL('./native_worker.py', import.meta.url));
    const args = pythonExecutable ? [worker, '--runtime-root', runtimeRoot] :
      ['-3.12', '-m', 'uv', 'run', '--project', runtimeRoot, 'python', worker, '--runtime-root', runtimeRoot];
    if (fixtureOrigin) args.push('--fixture-origin', fixtureOrigin);
    if (decision) args.push('--decision-model', decision.model, ...(decision.allowAuthenticatedState ? ['--allow-authenticated-state'] : []));
    const child = spawn(pythonExecutable || launcher, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', BH_RECORD: '0',
        BU_CDP_URL: cdpUrl, BU_NAME: 'copilot-discussion-native',
        OPENROUTER_API_KEY: decision ? process.env.OPENROUTER_API_KEY || '' : '', TYPESAFE_API_KEY: '', TEXT_MODEL_API_KEY: '',
        ...(decision ? { JEV_PROVIDER: 'openrouter', OPENROUTER_DECISIONS_MODEL: decision.model } : {}) } });
    const transport = new JevNativeTransport(child, { timeoutMs });
    let timer;
    try {
      transport.readyInfo = await Promise.race([transport.ready, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Jev Native startup timed out.')), timeoutMs);
      })]);
      return transport;
    } catch (error) { child.kill(); throw error; }
    finally { clearTimeout(timer); }
  }

  request(operation, args = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id); this.child.kill();
        reject(new Error('Native request timed out; its action may have executed. Inspect before retrying.'));
      }, this.timeoutMs);
      this.requests.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, operation, args })}\n`, error => {
        if (!error) return;
        clearTimeout(timer); this.requests.delete(id); reject(new Error('Native request transport failed.'));
      });
    });
  }

  async open(url) { this.binding = await this.request('open', { url }); return this.tab; }
  async attach(binding) { this.binding = await this.request('attach', binding); return this.tab; }
  get tab() { return { id: this.binding.target, url: () => this.request('url') }; }
  async read() { return this.request('read', { reader: readVisibleConversation.toString() }); }
  async fill(text, name) { return this.request('fill', { text, pattern: name?.source || String(name) }); }
  async send(name, expectedText, composerName) {
    return this.request('send', { pattern: name?.source || String(name), expectedText,
      composerPattern: composerName?.source || (composerName ? String(composerName) : undefined) });
  }
  async closeTab() { return this.request('close'); }
  async dispose() {
    this.child.stdin.end();
    if (this.child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { this.child.kill(); resolve(); }, 3000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    // Browser Harness may outlive the worker. Explicitly release our local
    // pipe handles even if a dependency daemon inherited a standard stream.
    this.lines.close();
    this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.stderr.destroy();
    this.child.unref();
  }
}
