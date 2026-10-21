import { promises as fs } from 'node:fs';
import { ResearchRun } from './research-run.mjs';

const [command, file] = process.argv.slice(2);
let run;
try {
  if (!file) throw new Error('用法：node research-cli.mjs <init|select|start|ask|collect|evidence|finish|export|verify|status|pause|resume|bind|submit> <请求.json>');
  const request = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
  run = command === 'init' ? await ResearchRun.create(request) : await ResearchRun.open(request.runFile);
  let result;
  if (command === 'init') result = { status: 'selecting', runFile: run.file };
  else if (command === 'select') result = await run.select(request);
  else if (command === 'start') result = await run.start(request);
  else if (command === 'ask') result = await run.ask(request);
  else if (command === 'evidence') result = await run.evidence(request.updates);
  else if (command === 'finish') result = await run.finish(request);
  else if (command === 'export' || command === 'verify') result = await run[command]();
  else result = await run.control(command, request);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'error', message: error.message, retrySend: false, runFile: run?.file }));
  process.exitCode = 1;
} finally { if (run) await run.dispose(); }
