import { describe, expect, it } from 'vitest';
import { SMOKE_DEADLINE_MS, runWithSmokeDeadline } from '../scripts/smoke.js';

describe('finite workbench smoke', () => {
  it('uses the specified 120 second wall-clock ceiling', () => {
    expect(SMOKE_DEADLINE_MS).toBe(120_000);
  });

  it('closes live resources before reporting a wall-clock timeout', async () => {
    let closed = false;
    const startedAt = performance.now();

    await expect(
      runWithSmokeDeadline(
        () => new Promise<never>(() => undefined),
        async () => {
          await Promise.resolve();
          closed = true;
        },
        15
      )
    ).rejects.toThrow(/15 ms wall-clock deadline/u);

    expect(closed).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });
});
