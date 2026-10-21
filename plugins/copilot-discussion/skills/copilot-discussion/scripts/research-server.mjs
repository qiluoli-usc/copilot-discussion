import { createInterface } from 'node:readline';
import { ResearchRun } from './research-run.mjs';
import { NativeClient } from './native-client.mjs';

// One question at a time. Completed answers are collected continuously in small
// slices; the host still reads each answer before choosing another question.
const client = new NativeClient();
let run;
let activeCollection;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  try { if (['pause', 'quit'].includes(JSON.parse(line).command)) activeCollection?.abort(); } catch {}
});
input.on('close', () => activeCollection?.abort());
console.log(JSON.stringify({ ready: true, protocol: 1, engine: 'jev-native-executor', modelCalls: 0 }));
try {
  for await (const line of input) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
      const { command, request = {} } = message;
      activeCollection = new AbortController();
      let result;
      if (command === 'quit') {
        await client.dispose();
        console.log(JSON.stringify({ id: message.id, ok: true, result: { status: 'closed' } }));
        break;
      }
      if (command === 'init' || command === 'open') {
        await client.dispose();
        run = command === 'init' ? await ResearchRun.create(request, { client }) : await ResearchRun.open(request.runFile, { client });
        result = { status: (await run.read()).status, runFile: run.file };
      } else {
        if (!run) throw new Error('先init或open研究运行。');
        if (command === 'select') result = await run.select(request);
        else if (command === 'start') result = await run.start(request);
        else if (command === 'ask') result = await run.ask({ waitMs: 15000, ...request });
        else if (command === 'watch') result = { status: 'pending' };
        else if (command === 'evidence') result = await run.evidence(request.updates);
        else if (command === 'finish') result = await run.finish(request);
        else if (command === 'export' || command === 'verify') result = await run[command]();
        else result = await run.control(command, request);
        if (result.status === 'pending' && request.continuous !== false &&
            ['ask', 'submit', 'collect', 'watch'].includes(command)) {
          result = await run.watch({ maxMs: request.watchMaxMs ?? 600000, sliceMs: request.sliceMs ?? 15000,
            signal: activeCollection.signal,
            onProgress: progress => console.log(JSON.stringify({ id: message.id, ...progress })) });
        }
      }
      console.log(JSON.stringify({ id: message.id, ok: true, result }));
    } catch (error) {
      console.log(JSON.stringify({ id: message?.id ?? null, ok: false, message: error.message, retrySend: false, runFile: run?.file }));
    }
    activeCollection = null;
  }
} finally { input.close(); await client.dispose(); }
