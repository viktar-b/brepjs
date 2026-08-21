export const WORKBENCH_THEME_STORAGE_KEY = 'infra-bridge-workbench-theme';

export type WorkbenchTheme = 'dark' | 'light';

export function resolveInitialWorkbenchTheme(): WorkbenchTheme {
  try {
    const saved = window.localStorage.getItem(WORKBENCH_THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function persistWorkbenchTheme(theme: WorkbenchTheme): void {
  try {
    window.localStorage.setItem(WORKBENCH_THEME_STORAGE_KEY, theme);
  } catch {
    // Theme switching still works for the current session when storage is unavailable.
  }
}
