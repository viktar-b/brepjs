export type WorkbenchMode = 'overall' | 'products';

export interface ModeRailProps {
  readonly mode: WorkbenchMode;
  readonly onChange: (mode: WorkbenchMode) => void;
}

const MODES: readonly {
  readonly id: WorkbenchMode;
  readonly label: string;
  readonly icon: 'models' | 'products';
}[] = [
  { id: 'overall', label: 'Overall comparison', icon: 'models' },
  { id: 'products', label: 'Manifest products', icon: 'products' },
];

/** Fixed icon-only navigation between whole-model and product-level diagnosis. */
export function ModeRail({ mode, onChange }: ModeRailProps) {
  return (
    <nav className="mode-rail" aria-label="Workbench modes">
      {MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          className="mode-rail__button"
          aria-label={item.label}
          aria-pressed={mode === item.id}
          data-tooltip={item.label}
          onClick={() => {
            onChange(item.id);
          }}
        >
          <ModeIcon name={item.icon} />
        </button>
      ))}
    </nav>
  );
}

function ModeIcon({ name }: { name: 'models' | 'products' }) {
  return name === 'models' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 5.5h7v13h-7zM13.5 5.5h7v13h-7z" />
      <path d="M6 9h2M16 9h2M6 12h2M16 12h2" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5h4v4H4zM4 14.5h4v4H4z" />
      <path d="M11 7.5h9M11 16.5h9" />
    </svg>
  );
}
