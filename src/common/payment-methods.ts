export function normalizePaymentMethod(method?: string | null, fallback = 'cash') {
  return String(method || fallback).trim().toLowerCase()
}
