import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_API_URL
const key = import.meta.env.VITE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error('Faltan VITE_API_URL o VITE_PUBLISHABLE_KEY en .env.local')
}

export const supabase = createClient(url, key)
