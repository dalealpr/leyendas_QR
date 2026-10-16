import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Modales abiertos, del más antiguo al más nuevo (para saber cuál está arriba) */
const openStack: string[] = []

interface Props {
  title: ReactNode
  /** Texto pequeño debajo del título */
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  /** Botones de abajo */
  footer?: ReactNode
  size?: 'sm' | 'md'
  /** false mientras hay algo en curso (ej. eliminando): no se puede cerrar */
  dismissible?: boolean
}

/**
 * Modal genérico: fondo oscuro, cierre con Escape / clic afuera / botón ✕,
 * bloquea el scroll de la página y se puede apilar (un modal sobre otro).
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'sm',
  dismissible = true,
}: Props) {
  const id = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const dismissibleRef = useRef(dismissible)

  useEffect(() => {
    closeRef.current = onClose
    dismissibleRef.current = dismissible
  })

  useEffect(() => {
    openStack.push(id)
    document.body.style.overflow = 'hidden'

    // Foco inicial: el primer campo con autoFocus, o el propio panel
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      // Solo el modal de más arriba responde a Escape
      if (e.key === 'Escape' && openStack.at(-1) === id && dismissibleRef.current) closeRef.current()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      openStack.splice(openStack.indexOf(id), 1)
      if (openStack.length === 0) document.body.style.overflow = ''
    }
  }, [id])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => dismissible && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-2xl bg-surface text-foreground shadow-xl outline-none ${
          size === 'md' ? 'max-w-md' : 'max-w-sm'
        }`}
      >
        <header className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-lg font-bold">
              {title}
            </h2>
            {description && <div className="text-sm text-foreground-soft">{description}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!dismissible}
            aria-label="Cerrar"
            className="-mr-2 -mt-2 shrink-0 rounded-lg p-2 text-foreground-soft hover:bg-surface-strong hover:text-foreground disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" className="h-7 w-7" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        {/* El contenido hace scroll si no cabe (celulares chicos) */}
        <div className="overflow-y-auto px-5 pb-5">{children}</div>

        {footer && <footer className="flex gap-2 border-t border-line p-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
