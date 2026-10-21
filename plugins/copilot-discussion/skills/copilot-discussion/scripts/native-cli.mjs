import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Session, DEFAULT_URL } from './session.mjs';
import { CopilotDiscussion } from './copilot.mjs';
import { JevNativeTransport, NATIVE_BROWSER_ID } from './jev-native.mjs';

export async function nativeCommand(command, request, {
  launch = options => JevNativeTransport.launch(options)
} = {}) {
  if (!['doctor', 'start', 'bind', 'ask', 'submit', 'recover-draft', 'collect', 'status', 'pause', 'resume', 'finish', 'close'].includes(command)) {
    throw new Error('支持 doctor、start、bind、ask、submit、recover-draft、collect、status、pause、resume、finish、close。');
  }
  if (command === 'doctor') {
    const transport = await launch({ runtimeRoot: request.runtimeRoot, launcher: request.launcher });
    try { return { status: 'ready', engine: 'jev-native-executor', remoteModelCalls: 0, provenance: transport.readyInfo?.provenance }; }
    finally { await transport.dispose(); }
  }
  let session;
  if (command === 'start') session = await Session.create(request);
  else session = await Session.open(request.sessionFile);
  if (['pause', 'resume', 'finish'].includes(command)) {
    const data = command === 'pause' ? await session.pause(request.reason) : command === 'resume' ?
      await session.resume() : await session.finish(request.summary);
    return { status: data.status, rounds: data.items.length, sessionFile: session.file, markdownFile: session.markdownFile };
  }
  const acquisitionStarted = performance.now();
  const acquisitionAt = new Date().toISOString();
  const transport = await launch({ runtimeRoot: request.runtimeRoot, launcher: request.launcher }).catch(error => {
    error.sessionFile = session.file; throw error;
  });
  await session.recordTiming({ operation: transport.reused ? 'worker-reuse' : 'worker-start', scope: 'runtime',
    startedAt: acquisitionAt, durationMs: performance.now() - acquisitionStarted, success: true }).catch(() => {});
  try {
    let tab;
    if (command === 'start') {
      tab = await transport.open(request.url || DEFAULT_URL);
      await session.update(data => {
        data.native = { ...transport.binding, engine: 'jev-native-executor', modelCalls: transport.decisionStats?.calls || 0,
          provenance: transport.readyInfo?.provenance || null };
      });
    } else {
      const data = await session.read();
      if (data.native?.engine !== 'jev-native-executor') throw new Error('记录没有 Jev Native 标签页绑定。');
      tab = transport.binding?.target === data.native.target && transport.binding?.owner === data.native.owner ?
        transport.tab : await transport.attach(data.native);
    }
    const discussion = new CopilotDiscussion(tab, session, {
      browserId: NATIVE_BROWSER_ID, transport, pollMs: 750, activePollMs: 1500, completionPollMs: 150
    });
    let result;
    if (command === 'start' || command === 'bind') {
      let error;
      const until = Date.now() + (request.readyWaitMs ?? 15000);
      do {
        try { await discussion.bindNew(); error = null; break; }
        catch (caught) { error = caught; }
        if (Date.now() >= until) break;
        await new Promise(resolve => setTimeout(resolve, 750));
      } while (Date.now() < until);
      result = error ? { status: 'needs_attention', message: '请在专用 Chrome 标签页完成登录或核对新对话，然后运行 bind。' } :
        { status: 'ready' };
    } else if (command === 'close') {
      await transport.closeTab(); result = { status: 'closed' };
    } else if (command === 'status') {
      const saved = await session.read();
      const snapshot = await discussion.snapshot('status');
      if (saved.binding) discussion.assertBinding(saved, snapshot);
      result = { status: saved.status, pending: saved.pending?.stage || null, rounds: saved.items.length,
        url: snapshot.url, generating: snapshot.generating, composerVisible: snapshot.composerVisible,
        entries: snapshot.entries };
    } else {
      // prepare() already checks identity, URL, last question and draft. A
      // redundant full rebind before ask adds no protection; recovery retains it.
      if (command !== 'ask') await discussion.rebind();
      if (command === 'ask') result = await discussion.exchange(request.question, {
        analysis: request.analysis || '', waitMs: request.waitMs ?? 45000
      });
      else if (command === 'recover-draft') result = await discussion.recoverDraft();
      else if (command === 'submit') {
        await discussion.submit(); result = await discussion.collect({ waitMs: request.waitMs ?? 45000 });
      }
      else result = await discussion.collect({ waitMs: request.waitMs ?? 45000 });
    }
    return { ...result, sessionFile: session.file, markdownFile: session.markdownFile,
      engine: 'jev-native-executor', remoteModelCalls: transport.decisionStats?.calls || 0, timingWarnings: discussion.timingWarnings };
  } catch (error) { error.sessionFile = session.file; throw error; }
  finally { await transport.dispose(); }
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, requestFile] = process.argv.slice(2);
  try {
    if (!requestFile) throw new Error('用法：node native-cli.mjs <command> <request.json>');
    const request = JSON.parse(await fs.readFile(requestFile, 'utf8'));
    console.log(JSON.stringify(await nativeCommand(command, request), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'error', message: error.message, retrySend: false }));
    process.exitCode = 1;
  }
}
