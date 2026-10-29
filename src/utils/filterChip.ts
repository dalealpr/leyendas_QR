/**
 * Número de los botones de filtro: dorado sobre el fondo oscuro.
 * En el filtro seleccionado (fondo dorado) va en el color del texto, para que se lea.
 */
export function countClass(selected: boolean): string {
  return `tabular-nums ${selected ? 'text-on-primary' : 'text-primary'}`
}
