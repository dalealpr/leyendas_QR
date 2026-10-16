import type { ReactNode } from 'react'

export interface Column<T> {
  /** Identificador único de la columna */
  key: string
  header: ReactNode
  /** Contenido de la celda */
  render: (row: T) => ReactNode
  /** Clases extra para la celda y el encabezado (ancho, alineación…) */
  className?: string
}

export interface Pagination {
  /** Página actual, empezando en 0 */
  page: number
  pageSize: number
  /** Total de filas (de todas las páginas) */
  total: number
  onPageChange: (page: number) => void
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  pagination?: Pagination
  loading?: boolean
  emptyMessage?: string
}

/**
 * Tabla genérica. Las columnas se definen por props y el paginado es
 * "controlado": el padre decide qué filas pasar para cada página
 * (sirve tanto para paginar en el servidor como en memoria).
 */
export function Table<T>({
  columns,
  rows,
  getRowKey,
  pagination,
  loading = false,
  emptyMessage = 'No hay datos.',
}: Props<T>) {
  return (
    <div className="overflow-hidden rounded-2xl bg-surface">
      {/* overflow-x-auto: en celulares la tabla se desplaza dentro de su caja, no la página */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-foreground-soft">
            <tr>
              {columns.map((col) => (
                <th key={col.key} scope="col" className={`whitespace-nowrap px-4 py-3 font-semibold ${col.className ?? ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={`divide-y divide-line ${loading ? 'opacity-50' : ''}`}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted">
                  {loading ? 'Cargando…' : emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={getRowKey(row)} className="hover:bg-surface-strong/50">
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 ${col.className ?? ''}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && <PaginationBar {...pagination} />}
    </div>
  )
}

function PaginationBar({ page, pageSize, total, onPageChange }: Pagination) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  const button =
    'rounded-lg bg-surface-strong px-3 py-2 text-sm font-semibold hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-surface-strong'

  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
      <span className="text-muted tabular-nums">
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 0}
          aria-label="Página anterior"
          className={button}
        >
          ‹
        </button>
        <span className="tabular-nums text-foreground-soft">
          {page + 1} / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount - 1}
          aria-label="Página siguiente"
          className={button}
        >
          ›
        </button>
      </div>
    </div>
  )
}
