import type { Ticket } from '../types/ticket'

// Medidas en mm (A4 vertical: 210 × 297)
const PAGE_WIDTH = 210
const QR_SIZE = 130
const QR_TOP = 55
const NAME_TOP = QR_TOP + QR_SIZE + 18
/** Margen blanco alrededor del QR, en módulos (los lectores lo necesitan) */
const QUIET_ZONE = 2

/** Alfabético por nombre; los "Sin nombre" van al final */
export function sortForPrint(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    if (!a.name) return b.name ? 1 : a.created_at.localeCompare(b.created_at)
    if (!b.name) return -1
    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  })
}

/**
 * PDF de un evento: una página por QR, con el nombre debajo.
 * Las librerías se cargan solo al pulsar el botón, para no hacer
 * más pesada la carga inicial de la app.
 */
export async function downloadEventPdf(
  tickets: Ticket[],
  eventName: string,
  onProgress?: (done: number, total: number) => void,
) {
  const [{ jsPDF }, QRCode] = await Promise.all([import('jspdf'), import('qrcode')])

  const sorted = sortForPrint(tickets)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const center = PAGE_WIDTH / 2

  for (const [i, ticket] of sorted.entries()) {
    if (i > 0) doc.addPage()

    // El QR se dibuja como cuadrados (vectorial): pesa muy poco y se ve
    // nítido con cualquier zoom. Una imagen PNG pesaría ~2 MB por página.
    const { modules } = QRCode.create(ticket.code, { errorCorrectionLevel: 'M' })
    const cells = modules.size + QUIET_ZONE * 2
    const cell = QR_SIZE / cells
    const left = center - QR_SIZE / 2
    doc.setFillColor(0, 0, 0)
    for (let row = 0; row < modules.size; row++) {
      // Junta los módulos negros seguidos de la fila en un solo rectángulo
      let col = 0
      while (col < modules.size) {
        if (!modules.get(row, col)) {
          col++
          continue
        }
        const start = col
        while (col < modules.size && modules.get(row, col)) col++
        doc.rect(
          left + (start + QUIET_ZONE) * cell,
          QR_TOP + (row + QUIET_ZONE) * cell,
          (col - start) * cell,
          cell,
          'F',
        )
      }
    }

    // Nombre debajo del QR (si es largo, se parte en varias líneas)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(26)
    doc.setTextColor(0, 0, 0)
    const lines = doc.splitTextToSize(ticket.name || 'Sin nombre', 170)
    doc.text(lines, center, NAME_TOP, { align: 'center' })

    // Número de orden, pequeño y abajo, para no perderse
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(150, 150, 150)
    doc.text(`${i + 1} / ${sorted.length}`, center, 285, { align: 'center' })

    onProgress?.(i + 1, sorted.length)
  }

  doc.save(`QR-${eventName.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.pdf`)
}
