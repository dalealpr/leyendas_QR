import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { supabase } from '../lib/supabase'
import type { NewTicket, Ticket } from '../types/ticket'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fileNameFor(ticket: Ticket): string {
  const base = ticket.name?.trim() || ticket.code.slice(0, 8)
  return `ticket-${base.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.png`
}

export function GenerarPage() {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const loadTickets = useCallback(async () => {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .returns<Ticket[]>()
    if (error) setError(error.message)
    else setTickets(data)
    setListLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde Supabase
    void loadTickets()
  }, [loadTickets])

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setCreating(true)
    const newTicket: NewTicket = { name: name.trim() || null }
    const { data, error } = await supabase
      .from('tickets')
      .insert(newTicket)
      .select()
      .single<Ticket>()
    setCreating(false)
    if (error) {
      setError(error.message)
      return
    }
    setSelected(data)
    setName('')
    setTickets((prev) => [data, ...prev])
  }

  const handleDownload = () => {
    if (!canvasRef.current || !selected) return
    const link = document.createElement('a')
    link.href = canvasRef.current.toDataURL('image/png')
    link.download = fileNameFor(selected)
    link.click()
  }

  const usedCount = tickets.filter((t) => t.used_at).length

  return (
    <div className="mx-auto w-full max-w-md space-y-6 p-4">
      {/* Formulario */}
      <form onSubmit={handleCreate} className="space-y-3 rounded-2xl bg-surface p-4">
        <h1 className="text-xl font-bold">Crear ticket</h1>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground-soft">
            Nombre del asistente (opcional)
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="w-full rounded-lg border border-line bg-background px-3 py-3 text-base text-foreground outline-none focus:border-primary"
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          className="w-full rounded-lg bg-primary py-3 text-base font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
        >
          {creating ? 'Creando…' : 'Crear ticket'}
        </button>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
            {error}
          </p>
        )}
      </form>

      {/* QR del ticket seleccionado */}
      {selected && (
        <section className="space-y-3 rounded-2xl bg-surface p-4 text-center">
          <p className="text-lg font-semibold">{selected.name || 'Sin nombre'}</p>
          {/* El QR siempre negro sobre blanco: es lo que mejor leen las cámaras */}
          <div className="mx-auto w-full max-w-xs rounded-xl bg-white p-3">
            <QRCodeCanvas
              ref={canvasRef}
              value={selected.code}
              size={512} // resolución del PNG descargado
              marginSize={2}
              level="M"
              // tamaño en pantalla: se adapta al contenedor (la librería pone 512px fijos por defecto)
              style={{ width: '100%', height: 'auto' }}
            />
          </div>
          <p className="break-all font-mono text-xs text-muted">{selected.code}</p>
          {selected.used_at && (
            <p className="text-sm text-danger-soft">Usado el {formatDate(selected.used_at)}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleDownload}
              className="flex-1 rounded-lg bg-primary py-3 font-semibold text-on-primary hover:bg-primary-hover"
            >
              Descargar PNG
            </button>
            <button
              onClick={() => setSelected(null)}
              className="rounded-lg bg-surface-strong px-4 py-3 font-semibold hover:bg-surface-hover"
            >
              Cerrar
            </button>
          </div>
        </section>
      )}

      {/* Listado */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Tickets</h2>
          <span className="text-sm text-muted">
            {usedCount} usados / {tickets.length} total
          </span>
        </div>

        {listLoading ? (
          <p className="text-muted">Cargando…</p>
        ) : tickets.length === 0 ? (
          <p className="text-muted">Todavía no hay tickets.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setSelected(t)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-strong"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.name || 'Sin nombre'}</p>
                    <p className="font-mono text-xs text-muted">{t.code.slice(0, 8)}…</p>
                  </div>
                  {t.used_at ? (
                    <span className="shrink-0 rounded-full bg-danger/15 px-2 py-1 text-xs font-semibold text-danger-soft">
                      Usado {formatDate(t.used_at)}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-success/15 px-2 py-1 text-xs font-semibold text-success">
                      Pendiente
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
