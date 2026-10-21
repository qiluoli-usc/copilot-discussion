import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePerformance } from '../skills/copilot-discussion/scripts/metrics.mjs';

test('显式排除补录轮次，旧记录缺少阶段数据时不伪造计时', () => {
  const report = summarizePerformance({ items: [
    { index: 1, sentAt: '2026-10-20T08:00:00.000Z', capturedAt: '2026-10-20T08:00:00.004Z' },
    { index: 2, sentAt: '2026-10-20T08:01:00.000Z', capturedAt: '2026-10-20T08:02:30.000Z' },
    { index: 3, sentAt: '2026-10-20T08:03:00.000Z', capturedAt: '2026-10-20T08:04:40.000Z' }
  ] }, { excludeTurns: [1] });
  assert.equal(report.samples, 2);
  assert.equal(report.meanSubmitToCaptureMs, 95000);
  assert.equal(report.meanCycleMs, null);
  assert.equal(report.rounds[0].excluded, true);
});

test('区分完整轮次、轮间间隔、观察延迟和浏览器调用', () => {
  const report = summarizePerformance({ items: [
    { index: 1, capturedAt: '2026-10-20T08:00:00Z' },
    { index: 2, answer: '中文😊', sentAt: '2026-10-20T08:00:30Z', capturedAt: '2026-10-20T08:01:00Z',
      timing: { proposedAt: '2026-10-20T08:00:10Z', sendActionCompletedAt: '2026-10-20T08:00:32Z', firstObservedAt: '2026-10-20T08:00:40Z' } }
  ], performance: { events: [
    { operation: 'snapshot', durationMs: 20000, success: true },
    { operation: 'snapshot', durationMs: 22000, success: false }
  ] } });
  assert.equal(report.rounds[1].cycleMs, 50000);
  assert.equal(report.rounds[1].gapBeforeRoundMs, 10000);
  assert.equal(report.rounds[1].firstObservedAfterClickMs, 8000);
  assert.equal(report.rounds[1].answerCharacters, 3);
  assert.equal(report.browser.snapshot.meanMs, 21000);
  assert.equal(report.browser.snapshot.failures, 1);
});

test('无效时间戳和倒序时间不产生负速度或虚假均值', () => {
  const report = summarizePerformance({ items: [
    { index: 1, sentAt: 'bad', capturedAt: 'bad' },
    { index: 2, sentAt: '2026-10-20T08:01:00Z', capturedAt: '2026-10-20T08:00:00Z' }
  ] });
  assert.equal(report.samples, 0);
  assert.equal(report.meanSubmitToCaptureMs, null);
});
