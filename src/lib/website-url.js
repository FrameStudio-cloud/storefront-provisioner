// Pure helpers for deciding what the provisioner is allowed to write to
// store_settings.website_url. No imports on purpose: deploy.js pulls in the
// Vercel and Supabase clients, and vercel.js exits the process when VERCEL_TOKEN
// is absent, so anything tested alongside it dies before a single assertion runs.

export const DEFAULT_PLATFORM_DOMAIN = 'keel.framestudio.co.ke'

// True when the stored value is one we could have written ourselves, and so may
// be replaced. Anything else is presumed to be an address the shop owner set
// deliberately — a client-owned custom domain in the future — and is left alone.
export function isManagedWebsiteUrl(value, platformDomain = DEFAULT_PLATFORM_DOMAIN) {
  if (!value) return true
  let host
  try {
    host = new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase()
  } catch {
    return false
  }
  if (host.endsWith('.vercel.app')) return true
  if (host === platformDomain || host.endsWith(`.${platformDomain}`)) return true
  return false
}
