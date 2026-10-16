interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Si se pasa y hay texto, muestra "N resultados para …" debajo */
  resultCount?: number
}

/** Buscador con lupa y botón ✕ para limpiar */
export function SearchInput({ value, onChange, placeholder = 'Buscar por nombre…', resultCount }: Props) {
  const text = value.trim()

  return (
    <div className="space-y-1">
      <div className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder.replace('…', '')}
          autoComplete="off"
          className="w-full rounded-lg border border-line bg-surface py-3 pl-10 pr-10 text-base text-foreground outline-none placeholder:text-muted focus:border-primary [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Limpiar búsqueda"
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
      {text && resultCount !== undefined && (
        <p className="text-xs text-muted" aria-live="polite">
          {resultCount === 1 ? '1 resultado' : `${resultCount} resultados`} para “{text}”
        </p>
      )}
    </div>
  )
}
