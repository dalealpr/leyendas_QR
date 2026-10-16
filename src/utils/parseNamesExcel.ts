import { readSheet, type CellValue } from 'read-excel-file/browser'

/** Título obligatorio de la columna, tal cual (en mayúscula) */
export const NAMES_HEADER = 'NOMBRES'
/** Máximo de nombres por archivo */
export const MAX_NAMES = 1000
/** Igual que el maxLength del formulario individual */
export const MAX_NAME_LENGTH = 100

export type ParseNamesResult =
  | { ok: true; names: string[]; duplicates: string[] }
  | { ok: false; error: string }

const text = (cell: CellValue | null | undefined) => (cell == null ? '' : String(cell).trim())

/**
 * Lee un .xlsx con una sola columna:
 *   A1  = NOMBRES
 *   A2… = un nombre por fila
 */
export async function parseNamesExcel(file: File): Promise<ParseNamesResult> {
  const fail = (error: string): ParseNamesResult => ({ ok: false, error })

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return fail('El archivo debe ser formato Excel (.xlsx).')
  }

  let data
  try {
    data = await readSheet(file) // primera hoja del libro
  } catch {
    return fail('No se pudo leer el archivo. Revisa que sea un Excel .xlsx válido.')
  }

  // Se ignoran las filas completamente vacías
  const rows = data.filter((row) => row.some((cell) => text(cell) !== ''))
  if (rows.length === 0) return fail('El archivo está vacío.')

  const hasOtherColumns = rows.some((row) => row.slice(1).some((cell) => text(cell) !== ''))
  if (hasOtherColumns) {
    return fail('El archivo debe tener una sola columna (A). Hay datos en otras columnas.')
  }

  const header = text(rows[0][0])
  if (header !== NAMES_HEADER) {
    return fail(
      `La primera fila debe decir ${NAMES_HEADER} (en mayúscula). Se encontró: "${header}".`,
    )
  }

  const names = rows.slice(1).map((row) => text(row[0])).filter(Boolean)
  if (names.length === 0) return fail(`No hay nombres debajo de ${NAMES_HEADER}.`)
  if (names.length > MAX_NAMES) {
    return fail(`Máximo ${MAX_NAMES} nombres por archivo. Este tiene ${names.length}.`)
  }

  const tooLong = names.find((n) => n.length > MAX_NAME_LENGTH)
  if (tooLong) {
    return fail(`Hay un nombre de más de ${MAX_NAME_LENGTH} caracteres: "${tooLong.slice(0, 30)}…".`)
  }

  // Repetidos dentro del archivo (sin distinguir mayúsculas): se avisa, no se bloquea
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const n of names) {
    const key = n.toLocaleLowerCase('es')
    if (seen.has(key)) duplicates.add(n)
    seen.add(key)
  }

  return { ok: true, names, duplicates: [...duplicates] }
}
