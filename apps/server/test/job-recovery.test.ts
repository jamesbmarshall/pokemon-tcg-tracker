import { expect, it } from 'vitest';
import { shouldCatchUp } from '../src/jobs.ts';

it('backs off interrupted and failed startup jobs even when their previous success is old', () => {
  const at = Date.parse('2026-10-24T15:00:00Z');
  const row = { last_status: 'running', last_started_at: '2026-10-24T14:59:00Z', last_finished_at: '2026-10-20T03:00:00Z' };
  expect(shouldCatchUp(row, 86_400_000, at)).toBe(false);
  expect(shouldCatchUp({ ...row, last_status: 'error', last_finished_at: '2026-10-24T14:59:30Z' }, 86_400_000, at)).toBe(false);
  expect(shouldCatchUp(row, 86_400_000, at + 3_600_000)).toBe(true);
  expect(shouldCatchUp({ ...row, last_status: 'ok', last_finished_at: '2026-10-24T03:00:00Z' }, 86_400_000, at)).toBe(false);
  expect(shouldCatchUp(undefined, 86_400_000, at)).toBe(true);
});
