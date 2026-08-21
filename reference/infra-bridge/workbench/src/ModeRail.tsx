export type WorkbenchMode = 'overall' | 'products' | 'source';

export interface ModeRailProps {
  readonly mode: WorkbenchMode;
  readonly onChange: (mode: WorkbenchMode) => void;
}

const MODES: readonly {
  readonly id: WorkbenchMode;
  readonly label: string;
  readonly icon: 'models' | 'products' | 'source';
}[] = [
  { id: 'overall', label: 'Overall comparison', icon: 'models' },
  { id: 'products', label: 'Manifest products', icon: 'products' },
  { id: 'source', label: 'Component source', icon: 'source' },
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

function ModeIcon({ name }: { name: 'models' | 'products' | 'source' }) {
  if (name === 'models') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 5.5h7v13h-7zM13.5 5.5h7v13h-7z" />
        <path d="M6 9h2M16 9h2M6 12h2M16 12h2" />
      </svg>
    );
  }
  if (name === 'products') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5.5h4v4H4zM4 14.5h4v4H4z" />
        <path d="M11 7.5h9M11 16.5h9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8.5 6-5 6 5 6M15.5 6l5 6-5 6M13.5 4l-3 16" />
    </svg>
  );
}
