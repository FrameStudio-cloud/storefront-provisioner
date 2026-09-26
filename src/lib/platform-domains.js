// Resolves which root domain a new storefront should be built under.
//
// platform_domains is the source of truth: one row per domain FrameStudio owns,
// exactly one of them flagged is_default. Owning another domain is a database
// insert plus one wildcard CNAME record — no deploy needed.
//
// Resolution order, most trusted first:
//   1. an explicit root passed by the caller
//   2. PLATFORM_DOMAIN in the environment (lets a Render instance be pinned to a
//      root without a database change, and acts as the emergency override)
//   3. the active default row in platform_domains
//   4. the built-in literal, so a database problem degrades instead of failing
//
// Only service_role reads this table, so these calls come from the provisioner's
// own Supabase client — the storefront templates never need it, because the root
// is baked into the rendered HTML at deploy time.

import { supabase } from '../db.js'
import { FALLBACK_ROOT_DOMAIN } from './domain.js'

// Roots change a handful of times a year, so a short cache avoids a database
// round trip on every deploy while still picking up a change quickly.
const CACHE_TTL_MS = 5 * 60_000
let cache = { value: null, expiresAt: 0 }

function normalise(value) {
  const host = String(value || '').toLowerCase().trim()
  return host.replace(/^\.+|\.+$/g, '')
}

function pick(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null
  const active = entries.filter((e) => e && e.active !== false)
  const pool = active.length > 0 ? active : entries
  const preferred = pool.find((e) => e.is_default)
  return normalise((preferred || pool[0]).domain) || null
}

export function cachedRoot() {
  return Date.now() < cache.expiresAt ? cache.value : null
}

export function clearRootCache() {
  cache = { value: null, expiresAt: 0 }
}

export async function resolveRootDomain({ root, force = false } = {}) {
  const explicit = normalise(root)
  if (explicit) return explicit

  const fromEnv = normalise(process.env.PLATFORM_DOMAIN)
  if (fromEnv) return fromEnv

  if (!force) {
    const cached = cachedRoot()
    if (cached) return cached
  }

  try {
    const { data, error } = await supabase
      .from('platform_domains')
      .select('domain, is_default, active')
      .eq('active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)

    if (error) throw new Error(error.message)

    const resolved = pick(data)
    if (resolved) {
      cache = { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS }
      return resolved
    }
    console.warn('[platform-domains] no active rows in platform_domains — using the built-in fallback')
  } catch (err) {
    console.warn(
      `[platform-domains] could not read platform_domains (${err.message}) — using ${FALLBACK_ROOT_DOMAIN}`
    )
  }

  return FALLBACK_ROOT_DOMAIN
}

// Every active root, for showing the owner what is available. Best-effort: the
// caller always gets at least the resolved default so the UI never renders blank.
export async function listRootDomains() {
  const defaultRoot = await resolveRootDomain()
  try {
    const { data, error } = await supabase
      .from('platform_domains')
      .select('domain, wildcard_host, is_default, active')
      .eq('active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    const rows = (data || [])
      .map((d) => ({ ...d, domain: normalise(d.domain) }))
      .filter((d) => d.domain)
    return rows.length > 0 ? rows : [{ domain: defaultRoot, is_default: true, active: true }]
  } catch (err) {
    console.warn(`[platform-domains] list failed (${err.message}) — returning the default only`)
    return [{ domain: defaultRoot, is_default: true, active: true }]
  }
}
