import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Modal } from '../ui/Modal'
import { PasswordInput } from '../ui/PasswordInput'

interface Props {
  title: ReactNode
  description?: ReactNode
  /** Aviso en rojo sobre lo que va a pasar */
  warning: ReactNode
  confirmLabel: string
  busyLabel?: string
  onClose: () => void
  /**
   * Ejecuta la acción con la contraseña escrita.
   * Devuelve null si salió bien, o el mensaje de error a mostrar.
   */
  onConfirm: (password: string) => Promise<string | null>
}

/** Modal que pide la contraseña del admin antes de una acción peligrosa */
export function PasswordConfirmDialog({
  title,
  description,
  warning,
  confirmLabel,
  busyLabel = 'Procesando…',
  onClose,
  onConfirm,
}: Props) {
  const formId = useId()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const message = await onConfirm(password)
    setBusy(false)
    if (message) {
      setPassword('')
      setError(message)
    }
  }

  return (
    <Modal
      title={title}
      description={description}
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
            type="submit"
            form={formId}
            disabled={busy || !password}
            className="flex-1 rounded-lg bg-danger py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
          {warning} Esta acción no se puede deshacer.
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground-soft">
            Contraseña del admin
          </span>
          <PasswordInput value={password} onChange={setPassword} autoFocus />
        </label>

        {error && (
          <p role="alert" className="text-sm text-danger-soft">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
