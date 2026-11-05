import { useState } from 'react'
import { Modal } from '../ui/Modal'

interface Props {
  title: string
  text: string
  confirmLabel: string
  onClose: () => void
  /** Devuelve null si salió bien o el mensaje de error */
  onConfirm: () => Promise<string | null>
}

/** Confirmación simple (sin contraseña) para acciones de borrar */
export function ConfirmDialog({ title, text, confirmLabel, onClose, onConfirm }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      title={title}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-lg bg-surface-strong py-3 font-semibold hover:bg-surface-hover disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(await onConfirm())
              setBusy(false)
            }}
            className="flex-1 rounded-lg bg-danger py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Quitando…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-foreground-soft">{text}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-soft">
          {error}
        </p>
      )}
    </Modal>
  )
}
