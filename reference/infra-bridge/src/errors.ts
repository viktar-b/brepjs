export type ReferenceHarnessErrorCode =
  | 'UNSUPPORTED_REPRESENTATION'
  | 'INVALID_INDICES'
  | 'PLACEMENT_FAILURE'
  | 'UNIT_FAILURE'
  | 'OPEN_TOPOLOGY'
  | 'INVALID_TOPOLOGY'
  | 'SCORING_FAILURE'
  | 'CHECKSUM_MISMATCH';

export type ReferenceHarnessErrorContext = Readonly<Record<string, string | number | boolean>>;

export interface ReferenceHarnessError {
  readonly code: ReferenceHarnessErrorCode;
  readonly message: string;
  readonly context: ReferenceHarnessErrorContext;
}

/** Construct a structured, serializable failure at a reference-adapter boundary. */
export function referenceHarnessError(
  code: ReferenceHarnessErrorCode,
  message: string,
  context: ReferenceHarnessErrorContext = {}
): ReferenceHarnessError {
  return { code, message, context };
}
