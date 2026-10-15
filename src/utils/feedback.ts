// Vibración y sonido al escanear. Si el navegador no los soporta, no hace nada.

let audioCtx: AudioContext | null = null

function beep(frequency: number, durationMs: number) {
  try {
    audioCtx ??= new AudioContext()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.frequency.value = frequency
    gain.gain.value = 0.2
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + durationMs / 1000)
  } catch {
    // sin audio disponible
  }
}

export function feedbackOk() {
  navigator.vibrate?.(150)
  beep(1200, 150)
}

export function feedbackError() {
  navigator.vibrate?.([300, 100, 300])
  beep(300, 500)
}
