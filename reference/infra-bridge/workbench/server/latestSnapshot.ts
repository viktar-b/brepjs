export type SnapshotComputationResult<Value, Failure> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: Failure };

export type RevisionedSnapshotResult<Value, Failure> =
  | { readonly ok: true; readonly revision: number; readonly value: Value }
  | { readonly ok: false; readonly revision: number; readonly error: Failure };

export interface LatestSnapshot<Value, Failure> {
  readonly current: () => Promise<RevisionedSnapshotResult<Value, Failure>>;
  readonly invalidate: () => number;
  readonly revision: () => number;
}

/**
 * Serializes expensive snapshot work and publishes only the newest requested revision.
 * Current failures remain retryable; successful current snapshots are memoized.
 */
export function createLatestSnapshot<Value, Failure>(
  compute: (revision: number) => Promise<SnapshotComputationResult<Value, Failure>>
): LatestSnapshot<Value, Failure> {
  let desiredRevision = 0;
  let published:
    { readonly ok: true; readonly revision: number; readonly value: Value } | undefined;
  let active: Promise<RevisionedSnapshotResult<Value, Failure>> | undefined;

  async function computeLatest(): Promise<RevisionedSnapshotResult<Value, Failure>> {
    for (;;) {
      const capturedRevision = desiredRevision;
      let result: SnapshotComputationResult<Value, Failure>;
      try {
        result = await compute(capturedRevision);
      } catch (cause) {
        if (capturedRevision !== desiredRevision) continue;
        throw cause;
      }

      if (capturedRevision !== desiredRevision) continue;

      if (!result.ok) {
        return {
          ok: false,
          revision: capturedRevision,
          error: result.error,
        };
      }

      published = {
        ok: true,
        revision: capturedRevision,
        value: result.value,
      };
      return published;
    }
  }

  function current(): Promise<RevisionedSnapshotResult<Value, Failure>> {
    if (published?.revision === desiredRevision) return Promise.resolve(published);
    if (active !== undefined) return active;

    active = computeLatest().finally(() => {
      active = undefined;
    });
    return active;
  }

  function invalidate(): number {
    desiredRevision += 1;
    published = undefined;
    return desiredRevision;
  }

  return {
    current,
    invalidate,
    revision: () => desiredRevision,
  };
}
