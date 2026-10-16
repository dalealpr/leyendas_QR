import { useRef, useState, type ChangeEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { NewTicket, Ticket } from '../../types/ticket'
import { MAX_NAMES, NAMES_HEADER, parseNamesExcel, type ParseNamesResult } from '../../utils/parseNamesExcel'

/** Se insertan de a bloques para no mandar una petición gigante */
const CHUNK_SIZE = 500

interface Props {
  eventId: string
  eventName: string
  /** Nombres que ya tienen ticket en este evento (en minúscula), para avisar */
  existingNames: Set<string>
  onCreated: (tickets: Ticket[]) => void
}

export function ExcelImport({ eventId, eventName, existingNames, onCreated }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState<ParseNamesResult | null>(null)
  const [creating, setCreating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setFileName(null)
    setResult(null)
    setProgress(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setError(null)
    setResult(null)
    if (!file) return
    setFileName(file.name)
    setParsing(true)
    setResult(await parseNamesExcel(file))
    setParsing(false)
  }

  const handleCreate = async () => {
    if (!result?.ok) return
    setError(null)
    setCreating(true)
    setProgress(0)

    const created: Ticket[] = []
    for (let i = 0; i < result.names.length; i += CHUNK_SIZE) {
      const chunk: NewTicket[] = result.names
        .slice(i, i + CHUNK_SIZE)
        .map((name) => ({ name, event_id: eventId }))
      const { data, error } = await supabase.from('tickets').insert(chunk).select().returns<Ticket[]>()
      if (error) {
        setError(
          `Error al crear los QR: ${error.message}` +
            (created.length ? ` (se alcanzaron a crear ${created.length}).` : ''),
        )
        break
      }
      created.push(...data)
      setProgress(created.length)
    }

    setCreating(false)
    if (created.length) onCreated(created)
    // Si se crearon todos, se limpia el formulario (el aviso lo muestra la página en un modal)
    if (created.length === result.names.length) reset()
  }

  const alreadyInEvent = result?.ok
    ? result.names.filter((n) => existingNames.has(n.toLocaleLowerCase('es')))
    : []

  return (
    <div className="space-y-4">
      {/* Condiciones del archivo */}
      <div className="space-y-3 rounded-xl border border-line bg-background p-4 text-sm">
        <p className="font-semibold">Condiciones del archivo</p>
        <ul className="list-disc space-y-1 pl-5 text-foreground-soft">
          <li>
            Formato Excel <strong className="text-foreground">.xlsx</strong>.
          </li>
          <li>
            Una sola columna (<strong className="text-foreground">A</strong>).
          </li>
          <li>
            La primera fila debe decir <strong className="text-primary">{NAMES_HEADER}</strong>, en
            mayúscula.
          </li>
          <li>Debajo, un nombre por fila. Las filas vacías se ignoran.</li>
          <li>Máximo {MAX_NAMES} nombres por archivo.</li>
        </ul>

        {/* Ejemplo visual */}
        <table className="w-full max-w-[220px] border border-line font-mono text-xs">
          <tbody>
            {[NAMES_HEADER, 'Juan Pérez', 'María López', 'Carlos Ruiz'].map((v, i) => (
              <tr key={v} className="border-b border-line last:border-b-0">
                <td className="w-8 border-r border-line bg-surface px-2 py-1 text-center text-muted">
                  {i + 1}
                </td>
                <td className={`px-2 py-1 ${i === 0 ? 'font-bold text-primary' : ''}`}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Selector de archivo */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-foreground-soft">Archivo Excel</span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleFile}
          disabled={creating}
          className="block w-full text-sm text-foreground-soft file:mr-3 file:rounded-lg file:border-0 file:bg-surface-strong file:px-4 file:py-2 file:font-semibold file:text-foreground hover:file:bg-surface-hover"
        />
      </label>

      {parsing && <p className="text-sm text-muted">Leyendo {fileName}…</p>}

      {result && !result.ok && (
        <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
          {result.error}
        </p>
      )}

      {/* Vista previa */}
      {result?.ok && (
        <div className="space-y-3 rounded-xl bg-background p-4 text-sm">
          <p>
            <strong className="text-primary">{result.names.length}</strong> nombres encontrados en{' '}
            <span className="text-muted">{fileName}</span>
          </p>
          <ol className="max-h-40 list-decimal overflow-y-auto pl-6 text-foreground-soft">
            {result.names.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ol>

          {result.duplicates.length > 0 && (
            <p className="rounded-lg bg-primary/15 px-3 py-2 text-foreground-soft">
              ⚠ Nombres repetidos en el archivo: {result.duplicates.join(', ')}. Se creará un QR por
              cada fila.
            </p>
          )}
          {alreadyInEvent.length > 0 && (
            <p className="rounded-lg bg-primary/15 px-3 py-2 text-foreground-soft">
              ⚠ {alreadyInEvent.length} nombre(s) ya tienen QR en {eventName}:{' '}
              {alreadyInEvent.slice(0, 5).join(', ')}
              {alreadyInEvent.length > 5 ? '…' : ''}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="flex-1 rounded-lg bg-primary py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
            >
              {creating
                ? `Creando… ${progress}/${result.names.length}`
                : `Generar ${result.names.length} QR para ${eventName}`}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={creating}
              className="rounded-lg bg-surface-strong px-4 py-3 font-semibold hover:bg-surface-hover disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
          {error}
        </p>
      )}
    </div>
  )
}
