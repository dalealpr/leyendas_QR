import { Modal } from '../ui/Modal'

interface Props {
  count: number
  eventName: string
  /** Total de QR del evento (incluye los que ya existían) */
  eventTotal: number
  pdfProgress: { done: number; total: number } | null
  onDownloadPdf: () => void
  onClose: () => void
}

/** Confirmación después de generar QR desde Excel */
export function BulkCreatedModal({
  count,
  eventName,
  eventTotal,
  pdfProgress,
  onDownloadPdf,
  onClose,
}: Props) {
  return (
    <Modal
      title="QR generados"
      description={<span className="font-semibold uppercase tracking-wide text-primary">{eventName}</span>}
      onClose={onClose}
      dismissible={pdfProgress === null}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={pdfProgress !== null}
            className="rounded-lg bg-surface-strong px-4 py-3 font-semibold hover:bg-surface-hover disabled:opacity-50"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={onDownloadPdf}
            disabled={pdfProgress !== null}
            className="flex-1 rounded-lg bg-primary py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {pdfProgress ? `Generando… ${pdfProgress.done}/${pdfProgress.total}` : 'Descargar PDF'}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-3xl text-success">
          ✓
        </div>
        <div>
          <p className="text-6xl font-black tabular-nums text-primary">{count}</p>
          <p className="mt-1 font-semibold">
            {count === 1 ? 'QR generado' : 'QR generados'} satisfactoriamente
          </p>
        </div>
        <p className="text-sm text-muted">
          {eventName} tiene ahora {eventTotal} QR en total. El PDF incluye todos, en orden alfabético.
        </p>
      </div>
    </Modal>
  )
}
