export function normalizePaymentMethod(method?: string | null, fallback = 'cash') {
  return String(method || fallback).trim().toLowerCase()
}

export function isAutoConfirmedGateway(_method?: string | null) {
  // Online gateways are confirmed by successful payment callbacks, not by method selection.
  return false
}
