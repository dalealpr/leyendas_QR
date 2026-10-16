import type { Role } from '../types/auth'

/** Pantalla inicial de cada rol después de iniciar sesión */
export function homeFor(role: Role): string {
  return role === 'scanner' ? '/escanear' : '/contador'
}
