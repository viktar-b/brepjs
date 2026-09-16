import { err, type Result } from 'brepjs';
import { geometryError, type BimError } from './errors/bimError.js';
import { reportedGeometryCleanup } from './geometryCleanupDiagnostics.js';
import {
  cleanupOwnedResources,
  cleanupReport,
  type OwnedBodyResource,
} from './productBodyCleanup.js';

export type OwnGeneratedResource = <T extends Disposable>(resource: T) => T;

/**
 * A recipe owns every allocation until all temporary cleanup has succeeded.
 * Register each fresh result before validation or another native call. Cleanup
 * runs in reverse allocation order, once per resource, even if releases throw.
 */
export function generateGeometry<T extends Disposable>(
  context: { readonly operation: string; readonly codePrefix: string },
  build: (own: OwnGeneratedResource) => Result<T, BimError>
): Result<T, BimError> {
  const owned: OwnedBodyResource[] = [];
  const registered = new Set<Disposable>();
  const own: OwnGeneratedResource = (resource) => {
    if (!registered.has(resource)) {
      registered.add(resource);
      // Recipe diagnostics use allocation positions, so separate failed releases
      // remain distinct even when a disposer throws the same Error object.
      owned.push({ resource, itemIndex: owned.length });
    }
    return resource;
  };
  let result: Result<T, BimError>;
  try {
    result = build(own);
  } catch (cause) {
    result = err(
      geometryError(`${context.codePrefix}_BUILD_FAILED`, `${context.operation} failed`, cause)
    );
  }
  if (result.ok) own(result.value);
  const survivor = result.ok ? result.value : undefined;
  const cleanup = cleanupOwnedResources(
    [...owned].reverse().filter(({ resource }) => resource !== survivor),
    context
  );
  const diagnostics = [
    ...(result.ok ? [] : reportedGeometryCleanup(result.error, context.operation)),
    ...(cleanup.kind === 'FAILED' ? cleanup.diagnostics : []),
  ];
  if (!result.ok) {
    return err({
      ...result.error,
      metadata: { ...result.error.metadata, cleanup: cleanupReport(diagnostics) },
    });
  }
  if (diagnostics.length === 0) return result;

  // A failed temporary release cancels the handoff. The output is still ours;
  // uncertain temporaries were already attempted and must never be retried.
  const outputCleanup = cleanupOwnedResources(
    owned.filter(({ resource }) => resource === survivor),
    context
  );
  if (outputCleanup.kind === 'FAILED') diagnostics.push(...outputCleanup.diagnostics);
  return err({
    ...geometryError(
      `${context.codePrefix}_CLEANUP_FAILED`,
      `${context.operation} temporary cleanup failed`
    ),
    metadata: { cleanup: cleanupReport(diagnostics) },
  });
}
