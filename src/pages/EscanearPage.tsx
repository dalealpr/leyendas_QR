import { useEffect, useRef, useState } from 'react'
import { Scanner, type IDetectedBarcode, type IScannerError } from '@yudiel/react-qr-scanner'
import { supabase } from '../lib/supabase'
import type { ValidateTicketResult } from '../types/ticket'
import { feedbackError, feedbackOk } from '../utils/feedback'

/** Tiempo que se muestra el resultado antes de volver a escanear */
const PAUSE_MS = 2000

type ScanResult = ValidateTicketResult | { ok: false; reason: 'error'; message: string }

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
  const [result, setResult] = useState<ScanResult | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  // Evita procesar dos lecturas a la vez (onScan puede llegar varias veces seguidas)
  const busyRef = useRef(false)
  const timeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timeoutRef.current), [])

  const resume = () => {
    window.clearTimeout(timeoutRef.current)
    setResult(null)
    busyRef.current = false
  }

  const handleScan = async (codes: IDetectedBarcode[]) => {
    const code = codes[0]?.rawValue.trim()
    if (!code || busyRef.current) return
    busyRef.current = true

    const { data, error } = await supabase.rpc('validate_ticket', { p_code: code })

    const scan: ScanResult = error
      ? { ok: false, reason: 'error', message: error.message }
      : (data as ValidateTicketResult)

    if (scan.ok) feedbackOk()
    else feedbackError()

    setResult(scan)
    timeoutRef.current = window.setTimeout(resume, PAUSE_MS)
  }

  const handleError = (err: IScannerError) => {
    setCameraError(cameraErrors[err.kind] ?? `Error de cámara: ${err.message}`)
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-black">
      <Scanner
        onScan={handleScan}
        onError={handleError}
        paused={result !== null}
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

      {cameraError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background p-6 text-center">
          <p className="text-lg text-danger-soft">{cameraError}</p>
        </div>
      )}

      {result && <ResultOverlay result={result} onClose={resume} />}
    </div>
  )
}

function ResultOverlay({ result, onClose }: { result: ScanResult; onClose: () => void }) {
  let title: string
  let detail: string | null = null

  if (result.ok) {
    title = 'INGRESO OK'
    detail = result.name
  } else if (result.reason === 'ya_usado') {
    title = 'YA USADO'
    detail = `Usado a las ${formatTime(result.used_at)}`
  } else if (result.reason === 'invalido') {
    title = 'QR INVÁLIDO'
  } else {
    title = 'ERROR'
    detail = result.message
  }

  return (
    <button
      type="button"
      onClick={onClose}
      className={`absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white ${
        result.ok ? 'bg-success' : 'bg-danger'
      }`}
    >
      <span className="text-7xl" aria-hidden="true">
        {result.ok ? '✓' : '✕'}
      </span>
      <span className="text-4xl font-black tracking-wide sm:text-5xl">{title}</span>
      {detail && <span className="text-2xl font-semibold">{detail}</span>}
      <span className="mt-6 text-sm opacity-80">Toca para seguir escaneando</span>
    </button>
  )
}
