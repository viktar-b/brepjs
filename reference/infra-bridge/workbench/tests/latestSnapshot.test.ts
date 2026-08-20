import { describe, expect, it } from 'vitest';
import { createLatestSnapshot } from '../server/latestSnapshot.js';

describe('serialized latest authored snapshot coordinator', () => {
  it('deduplicates concurrent requests and publishes one current success', async () => {
    let calls = 0;
    const snapshots = createLatestSnapshot((revision) => {
      calls += 1;
      return Promise.resolve({
        ok: true as const,
        value: `snapshot-${revision.toString()}`,
      });
    });

    const [first, second] = await Promise.all([snapshots.current(), snapshots.current()]);

    expect(first).toEqual({ ok: true, revision: 0, value: 'snapshot-0' });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(await snapshots.current()).toEqual(first);
  });

  it('discards stale success and serially computes only the latest desired revision', async () => {
    const computations: Array<ReturnType<typeof deferred<string>>> = [];
    let active = 0;
    let maximumActive = 0;
    const snapshots = createLatestSnapshot(async (revision) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const computation = deferred<string>();
      computations.push(computation);
      const value = await computation.promise;
      active -= 1;
      return { ok: true as const, value: `${revision.toString()}:${value}` };
    });

    const requestedBeforeEdit = snapshots.current();
    expect(computations).toHaveLength(1);
    expect(snapshots.invalidate()).toBe(1);
    const requestedAfterEdit = snapshots.current();
    computations[0]?.resolve('old');
    await waitFor(() => computations.length === 2);
    computations[1]?.resolve('new');

    await expect(requestedBeforeEdit).resolves.toEqual({ ok: true, revision: 1, value: '1:new' });
    await expect(requestedAfterEdit).resolves.toEqual({ ok: true, revision: 1, value: '1:new' });
    expect(maximumActive).toBe(1);
  });

  it('discards a stale error instead of replacing the newer success', async () => {
    const first = deferred<{ readonly ok: false; readonly error: string }>();
    let calls = 0;
    const snapshots = createLatestSnapshot(async (revision) => {
      calls += 1;
      return revision === 0
        ? first.promise
        : Promise.resolve({ ok: true as const, value: 'recovered' });
    });

    const pending = snapshots.current();
    snapshots.invalidate();
    first.resolve({ ok: false, error: 'stale failure' });

    await expect(pending).resolves.toEqual({ ok: true, revision: 1, value: 'recovered' });
    expect(calls).toBe(2);
  });

  it('discards a stale rejected computation and evaluates the newest revision', async () => {
    const first = deferred<{ readonly ok: true; readonly value: string }>();
    let calls = 0;
    const snapshots = createLatestSnapshot(async (revision) => {
      calls += 1;
      return revision === 0
        ? first.promise
        : Promise.resolve({ ok: true as const, value: 'recovered' });
    });

    const requestedBeforeEdit = snapshots.current();
    expect(snapshots.invalidate()).toBe(1);
    const requestedAfterEdit = snapshots.current();
    first.reject(new Error('stale evaluator crash'));

    await expect(requestedBeforeEdit).resolves.toEqual({
      ok: true,
      revision: 1,
      value: 'recovered',
    });
    await expect(requestedAfterEdit).resolves.toEqual({
      ok: true,
      revision: 1,
      value: 'recovered',
    });
    expect(calls).toBe(2);
  });

  it('does not permanently cache a current failure', async () => {
    let calls = 0;
    const snapshots = createLatestSnapshot((revision) => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? { ok: false as const, error: 'temporary' }
          : { ok: true as const, value: `snapshot-${revision.toString()}` }
      );
    });

    await expect(snapshots.current()).resolves.toEqual({
      ok: false,
      revision: 0,
      error: 'temporary',
    });
    await expect(snapshots.current()).resolves.toEqual({
      ok: true,
      revision: 0,
      value: 'snapshot-0',
    });
    expect(calls).toBe(2);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error('condition was not reached');
}
