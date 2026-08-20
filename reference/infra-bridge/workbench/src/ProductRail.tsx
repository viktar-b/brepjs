import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkbenchProduct } from '../shared/protocol.js';

export interface ProductRailProps {
  readonly products: readonly WorkbenchProduct[];
  readonly selectedKey: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (semanticKey: string) => void;
}

export function ProductRail({
  products,
  selectedKey,
  query,
  onQueryChange,
  onSelect,
}: ProductRailProps) {
  const [copiedKey, setCopiedKey] = useState<string>();
  const copyTimer = useRef<number | undefined>(undefined);
  const copyAttempt = useRef(0);
  const groups = useMemo(() => groupedProducts(products, query), [products, query]);
  const filteredProducts = useMemo(() => groups.flatMap(([, entries]) => entries), [groups]);
  const selected = products.find(({ semanticKey }) => semanticKey === selectedKey);
  const compactValue = filteredProducts.some(({ semanticKey }) => semanticKey === selectedKey)
    ? selectedKey
    : '';
  const copied = copiedKey === selectedKey;

  useEffect(() => {
    copyAttempt.current += 1;
    if (copyTimer.current !== undefined) {
      window.clearTimeout(copyTimer.current);
      copyTimer.current = undefined;
    }
    setCopiedKey(undefined);

    return () => {
      copyAttempt.current += 1;
      if (copyTimer.current !== undefined) {
        window.clearTimeout(copyTimer.current);
        copyTimer.current = undefined;
      }
    };
  }, [selectedKey]);

  const copyKey = async () => {
    const semanticKey = selectedKey;
    const attempt = ++copyAttempt.current;
    if (copyTimer.current !== undefined) {
      window.clearTimeout(copyTimer.current);
      copyTimer.current = undefined;
    }
    try {
      await navigator.clipboard.writeText(semanticKey);
      if (copyAttempt.current !== attempt) return;
      setCopiedKey(semanticKey);
      copyTimer.current = window.setTimeout(() => {
        if (copyAttempt.current === attempt) setCopiedKey(undefined);
        copyTimer.current = undefined;
      }, 1_500);
    } catch {
      if (copyAttempt.current === attempt) setCopiedKey(undefined);
    }
  };

  return (
    <aside className="product-pane" aria-label="Component selector">
      <div className="product-pane__header">
        <div>
          <span className="panel-kicker">Manifest products</span>
          <strong>{products.length.toString().padStart(2, '0')} occurrences</strong>
        </div>
        <label className="search-field">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
            }}
            placeholder="Filter by key or family"
            aria-label="Search Semantic Keys"
          />
          {query.length > 0 && (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear Semantic Key search"
              onClick={() => {
                onQueryChange('');
              }}
            >
              ×
            </button>
          )}
        </label>

        <label className="compact-product-select">
          <span>Selected component</span>
          <select
            aria-label="Select Semantic Key"
            value={compactValue}
            onChange={(event) => {
              onSelect(event.target.value);
            }}
          >
            {filteredProducts.length === 0 ? (
              <option value="" disabled>
                No matching occurrences
              </option>
            ) : (
              <>
                {compactValue.length === 0 && (
                  <option value="" disabled>
                    {filteredProducts.length} matching occurrence
                    {filteredProducts.length === 1 ? '' : 's'} · choose component
                  </option>
                )}
                {filteredProducts.map((product) => (
                  <option key={product.semanticKey} value={product.semanticKey}>
                    {product.group} · {product.detail} · {product.semanticKey}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>
      </div>

      <nav className="product-groups" aria-label="Semantic Key products">
        {groups.length === 0 ? (
          <div className="empty-filter">
            <span aria-hidden="true">∅</span>
            <strong>No matching occurrence</strong>
            <button
              type="button"
              onClick={() => {
                onQueryChange('');
              }}
            >
              Clear filter
            </button>
          </div>
        ) : (
          groups.map(([group, entries]) => (
            <section className="product-group" key={group} aria-labelledby={groupId(group)}>
              <h2 id={groupId(group)}>
                <span>{group}</span>
                <small>{entries.length}</small>
              </h2>
              <div className="product-list">
                {entries.map((product) => {
                  const active = product.semanticKey === selectedKey;
                  return (
                    <button
                      type="button"
                      className="product-option"
                      key={product.semanticKey}
                      data-semantic-key={product.semanticKey}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        onSelect(product.semanticKey);
                      }}
                    >
                      <span className="product-option__indicator" aria-hidden="true" />
                      <span className="product-option__copy">
                        <strong>{product.label}</strong>
                        <small>{product.detail}</small>
                      </span>
                      <code>{leafKey(product.semanticKey)}</code>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </nav>

      <div className="selected-key">
        <div>
          <span>Selected Semantic Key</span>
          <strong>{selected?.label ?? leafKey(selectedKey)}</strong>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Copy selected Semantic Key"
          title={copied ? 'Copied' : 'Copy full key'}
          onClick={() => void copyKey()}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <code>{selectedKey}</code>
      </div>
    </aside>
  );
}

function groupedProducts(
  products: readonly WorkbenchProduct[],
  query: string
): ReadonlyArray<readonly [string, WorkbenchProduct[]]> {
  const normalized = query.trim().toLocaleLowerCase();
  const groups = new Map<string, WorkbenchProduct[]>();
  for (const product of products) {
    if (
      normalized.length > 0 &&
      !`${product.group} ${product.label} ${product.detail} ${product.semanticKey}`
        .toLocaleLowerCase()
        .includes(normalized)
    ) {
      continue;
    }
    const group = groups.get(product.group) ?? [];
    group.push(product);
    groups.set(product.group, group);
  }
  return [...groups.entries()];
}

function leafKey(semanticKey: string): string {
  return semanticKey.split('/').at(-1) ?? semanticKey;
}

function groupId(group: string): string {
  return `product-group-${group.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.25" />
      <path d="m12.5 12.5 4 4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="6.25" y="6.25" width="9" height="9" rx="1.5" />
      <path d="M13.75 6.25v-2a1.5 1.5 0 0 0-1.5-1.5h-8a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m3.5 10.25 4 4 9-9" />
    </svg>
  );
}
