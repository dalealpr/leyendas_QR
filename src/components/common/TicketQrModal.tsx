import { useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { Modal } from '../ui/Modal'
import type { Ticket } from '../../types/ticket'

function safe(text: string): string {
  return text.replace(/[^\p{L}\p{N}_-]+/gu, '_')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  ticket: Ticket
  eventName: string
  onClose: () => void
  /** Si se pasa, muestra un aviso verde arriba (ej. "QR generado correctamente") */
  successMessage?: string
}

/** Muestra un QR grande con su nombre, para descargarlo como PNG */
export function TicketQrModal({ ticket, eventName, onClose, successMessage }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const handleDownload = () => {
    if (!canvasRef.current) return
    const base = ticket.name?.trim() || ticket.code.slice(0, 8)
    const link = document.createElement('a')
    link.href = canvasRef.current.toDataURL('image/png')
    link.download = `ticket-${safe(eventName)}-${safe(base)}.png`
    link.click()
  }

  return (
    <Modal
      title={ticket.name || 'Sin nombre'}
      description={<span className="font-semibold uppercase tracking-wide text-primary">{eventName}</span>}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={handleDownload}
          className="flex-1 rounded-lg bg-primary py-3 font-semibold text-on-primary hover:bg-primary-hover"
        >
          Descargar PNG
        </button>
      }
    >
      <div className="space-y-3 text-center">
        {successMessage && (
          <p role="status" className="rounded-lg bg-success/15 px-3 py-2 text-sm font-semibold text-success">
            ✓ {successMessage}
          </p>
        )}

        {/* El QR siempre negro sobre blanco: es lo que mejor leen las cámaras */}
        <div className="mx-auto w-full max-w-70 rounded-xl bg-white p-3">
          <QRCodeCanvas
            ref={canvasRef}
            value={ticket.code}
            size={512} // resolución del PNG descargado
            marginSize={2}
            level="M"
            // tamaño en pantalla: se adapta al contenedor (la librería pone 512px fijos por defecto)
            style={{ width: '100%', height: 'auto' }}
          />
        </div>

        <p className="break-all font-mono text-xs text-muted">{ticket.code}</p>

        {ticket.used_at ? (
          <p className="text-sm font-semibold text-success">Escaneado el {formatDate(ticket.used_at)}</p>
        ) : (
          <p className="text-sm text-foreground-soft">No escaneado</p>
        )}
      </div>
    </Modal>
  )
}
