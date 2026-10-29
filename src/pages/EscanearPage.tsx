import { useEffect, useRef, useState } from 'react'
import { Scanner, type IDetectedBarcode, type IScannerError } from '@yudiel/react-qr-scanner'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/auth-context'
import { useActiveEvent } from '../hooks/useActiveEvent'
import type { RegisterGuestResult, ValidateTicketResult } from '../types/ticket'
import { feedbackError, feedbackOk } from '../utils/feedback'

/** Tiempo que se muestra el resultado antes de volver a escanear */
const PAUSE_MS = 2000

/** Lo que se muestra encima de la cámara */
type Screen =
  | { kind: 'message'; ok: boolean; title: string; detail: string | null }
  /** Preguntar por el invitado. entered = el titular acaba de ingresar con este escaneo */
  | { kind: 'guest'; code: string; name: string | null; entered: boolean; usedAt: string | null }

const cameraErrors: Partial<Record<IScannerError['kind'], string>> = {
  'permission-denied': 'No diste permiso para usar la cámara. Actívalo en la configuración del navegador.',
  'no-camera': 'No se encontró ninguna cámara.',
  'in-use': 'La cámara está siendo usada por otra aplicación.',
  'insecure-context': 'La cámara solo funciona con HTTPS.',
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function EscanearPage() {
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  const { activeEvent, loaded } = useActiveEvent()

  const [screen, setScreen] = useState<Screen | null>(null)
  const [guestBusy, setGuestBusy] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  // Evita procesar dos lecturas a la vez (onScan puede llegar varias veces seguidas)
  const busyRef = useRef(false)
  const timeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timeoutRef.current), [])

  const resume = () => {
    window.clearTimeout(timeoutRef.current)
    setScreen(null)
    busyRef.current = false
  }

  /** Muestra un resultado y vuelve a escanear solo después de PAUSE_MS */
  const showMessage = (ok: boolean, title: string, detail: string | null = null) => {
    if (ok) feedbackOk()
    else feedbackError()
    setScreen({ kind: 'message', ok, title, detail })
    timeoutRef.current = window.setTimeout(resume, PAUSE_MS)
  }

  const handleScan = async (codes: IDetectedBarcode[]) => {
    const code = codes[0]?.rawValue.trim()
    if (!code || busyRef.current) return
    busyRef.current = true

    const { data, error } = await supabase.rpc('validate_ticket', { p_code: code })
    if (error) {
      showMessage(false, 'ERROR', error.message)
      return
    }

    const result = data as ValidateTicketResult
    // Eventos con invitado: se pregunta y la pantalla espera la respuesta (sin tiempo límite)
    if (result.ok && result.guests) {
      feedbackOk()
      setScreen({ kind: 'guest', code, name: result.name, entered: true, usedAt: null })
    } else if (!result.ok && result.reason === 'invitado_pendiente') {
      feedbackOk()
      setScreen({ kind: 'guest', code, name: result.name, entered: false, usedAt: result.used_at })
    } else {
      const { ok, title, detail } = describeScan(result)
      showMessage(ok, title, detail)
    }
  }

  const registerGuest = async (code: string) => {
    setGuestBusy(true)
    const { data, error } = await supabase.rpc('register_guest', { p_code: code })
    setGuestBusy(false)
    if (error) {
      showMessage(false, 'ERROR', error.message)
      return
    }
    const result = data as RegisterGuestResult
    if (result.ok) showMessage(true, 'INVITADO OK', result.name ? `Invitado de ${result.name}` : null)
    else if (result.reason === 'ya_ingresado')
      showMessage(false, 'INVITADO YA INGRESÓ', `A las ${formatTime(result.guest_at)}`)
    else showMessage(false, guestErrors[result.reason])
  }

  const handleError = (err: IScannerError) => {
    setCameraError(cameraErrors[err.kind] ?? `Error de cámara: ${err.message}`)
  }

  // El staff (no admin) solo escanea con un evento activo: sin él, ni se abre la cámara
  if (!isAdmin && !loaded) {
    return <div className="flex flex-1 items-center justify-center text-muted">Cargando…</div>
  }
  if (!isAdmin && !activeEvent) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="text-5xl" aria-hidden="true">
          ⏸
        </span>
        <p className="text-xl font-bold">El evento no ha sido activado</p>
        <p className="text-foreground-soft">Actívalo con la cuenta admin para poder escanear.</p>
        <p className="text-xs text-muted">Esta pantalla se actualiza sola cuando se active.</p>
      </div>
    )
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-black">
      <Scanner
        onScan={handleScan}
        onError={handleError}
        paused={screen !== null}
        formats={['qr_code']}
        constraints={{ facingMode: 'environment' }}
        allowMultiple
        scanDelay={500}
        sound={false}
        components={{ finder: true, torch: true }}
        styles={{
          container: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
          video: { width: '100%', height: '100%', objectFit: 'cover' },
        }}
      />

      {/* Qué evento se está validando */}
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
        <span className="flex max-w-full items-center gap-2 truncate rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-white">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${activeEvent ? 'bg-success' : 'bg-primary'}`}
            aria-hidden="true"
          />
          {isAdmin
            ? `Admin · acepta todos los eventos${activeEvent ? ` (activo: ${activeEvent.name})` : ''}`
            : activeEvent?.name}
        </span>
      </div>

      {cameraError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background p-6 text-center">
          <p className="text-lg text-danger-soft">{cameraError}</p>
        </div>
      )}

      {screen?.kind === 'message' && (
        <ResultOverlay ok={screen.ok} title={screen.title} detail={screen.detail} onClose={resume} />
      )}
      {screen?.kind === 'guest' && (
        <GuestOverlay
          name={screen.name}
          entered={screen.entered}
          usedAt={screen.usedAt}
          busy={guestBusy}
          onYes={() => void registerGuest(screen.code)}
          onNo={resume}
        />
      )}
    </div>
  )
}

/** Mensajes de register_guest que no traen datos extra */
const guestErrors: Record<Exclude<RegisterGuestResult, { ok: true } | { reason: 'ya_ingresado' }>['reason'], string> = {
  invalido: 'QR INVÁLIDO',
  otro_evento: 'OTRO EVENTO',
  sin_evento_activo: 'SIN EVENTO ACTIVO',
  sin_invitados: 'EVENTO SIN INVITADOS',
  titular_pendiente: 'TITULAR NO HA INGRESADO',
}

function describeScan(result: ValidateTicketResult): { ok: boolean; title: string; detail: string | null } {
  if (result.ok) return { ok: true, title: 'INGRESO OK', detail: result.name }
  switch (result.reason) {
    case 'ya_usado':
      return {
        ok: false,
        title: 'YA USADO',
        detail: result.guest_at
          ? `Titular ${formatTime(result.used_at)} · Invitado ${formatTime(result.guest_at)}`
          : `Usado a las ${formatTime(result.used_at)}`,
      }
    case 'invalido':
      return { ok: false, title: 'QR INVÁLIDO', detail: null }
    case 'otro_evento':
      return { ok: false, title: 'OTRO EVENTO', detail: result.event_name ? `Este QR es de ${result.event_name}` : null }
    case 'sin_evento_activo':
      return { ok: false, title: 'SIN EVENTO ACTIVO', detail: 'Pide al admin que active el evento' }
    case 'invitado_pendiente':
      // La pantalla de invitado se encarga de este caso; aquí solo por completitud
      return { ok: false, title: 'INVITADO PENDIENTE', detail: result.name }
  }
}

interface GuestOverlayProps {
  name: string | null
  /** true = el titular acaba de ingresar; false = ya había ingresado antes */
  entered: boolean
  usedAt: string | null
  busy: boolean
  onYes: () => void
  onNo: () => void
}

/** Pregunta si entra el invitado del QR */
function GuestOverlay({ name, entered, usedAt, busy, onYes, onNo }: GuestOverlayProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={entered ? '¿Viene con invitado?' : '¿Ingresa el invitado?'}
      className={`absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white ${
        entered ? 'bg-success' : 'bg-warning'
      }`}
    >
      <span className="text-6xl" aria-hidden="true">
        {entered ? '✓' : '⏳'}
      </span>
      <span className="text-4xl font-black tracking-wide sm:text-5xl">
        {entered ? 'INGRESO OK' : 'TITULAR YA INGRESÓ'}
      </span>
      {name && <span className="text-2xl font-semibold">{name}</span>}
      {!entered && usedAt && <span className="text-lg opacity-90">A las {formatTime(usedAt)}</span>}

      <p className="mt-4 text-2xl font-bold">{entered ? '¿Viene con invitado?' : '¿Ingresa el invitado?'}</p>
      <div className="flex w-full max-w-sm gap-3">
        <button
          type="button"
          onClick={onNo}
          disabled={busy}
          className="flex-1 rounded-2xl border-2 border-white py-5 text-xl font-bold hover:bg-white/15 disabled:opacity-50"
        >
          {entered ? 'Sin invitado' : 'Cancelar'}
        </button>
        <button
          type="button"
          onClick={onYes}
          disabled={busy}
          className="flex-1 rounded-2xl bg-white py-5 text-xl font-bold text-black hover:bg-white/90 disabled:opacity-50"
        >
          {busy ? 'Guardando…' : entered ? 'Con invitado' : 'Sí, ingresa'}
        </button>
      </div>
      {entered && <span className="text-sm opacity-80">Si viene después, escanea este QR otra vez</span>}
    </div>
  )
}

interface ResultOverlayProps {
  ok: boolean
  title: string
  detail: string | null
  onClose: () => void
}

function ResultOverlay({ ok, title, detail, onClose }: ResultOverlayProps) {
  return (
    <button
      type="button"
      onClick={onClose}
      className={`absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white ${
        ok ? 'bg-success' : 'bg-danger'
      }`}
    >
      <span className="text-7xl" aria-hidden="true">
        {ok ? '✓' : '✕'}
      </span>
      <span className="text-4xl font-black tracking-wide sm:text-5xl">{title}</span>
      {detail && <span className="text-2xl font-semibold">{detail}</span>}
      <span className="mt-6 text-sm opacity-80">Toca para seguir escaneando</span>
    </button>
  )
}
