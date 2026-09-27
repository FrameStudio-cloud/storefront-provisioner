import { createHash } from 'node:crypto'

// Reserved names that shops may not claim as their subdomain.
const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'admin', 'administrator', 'dashboard', 'app', 'apps', 'mail',
  'email', 'smtp', 'ftp', 'ssh', 'dev', 'development', 'staging', 'test',
  'testing', 'qa', 'uat', 'prod', 'production', 'preview', 'support', 'help',
  'status', 'blog', 'news', 'docs', 'documentation', 'forum', 'community',
  'cdn', 'assets', 'static', 'media', 'img', 'images', 'files', 'upload',
  'uploads', 'download', 'store', 'shop', 'shops', 'storefront', 'storefronts',
  'keel', 'keelapp', 'framestudio', 'auth', 'login', 'signup', 'signin',
  'signup', 'account', 'accounts', 'my', 'portal', 'secure', 'beta', 'demo',
  'sandbox', 'v1', 'v2', 'v3', 'billing', 'pay', 'payments', 'checkout',
  'webhooks', 'callback', 'redirect', 'proxy', 'gateway', 'redirect',
])

// Fallback root. platform_domains in the database is the source of truth (one row
// per domain FrameStudio owns, with exactly one active default); this literal only
// applies if the table cannot be read, so a database hiccup degrades to the
// long-standing domain instead of failing every deploy. Keep in step with
// DEFAULT_PLATFORM_DOMAIN in website-url.js and FALLBACK_ROOT_DOMAIN in the Keel app.
export const FALLBACK_ROOT_DOMAIN = 'keel.framestudio.co.ke'

export function sanitiseLabel(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function sanitiseRoot(value) {
  // trim() before the dot strip, or " .example.com. " keeps its spaces and
  // becomes "shop. .example.com. "
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/^\.+|\.+$/g, '')
}

// Build the FQDN for a storefront label. The root is a parameter so owning more
// domains is a database insert, not a code change — *.keel.framestudio.co.ke is
// CNAMEd to cname.vercel-dns.com, and a new root needs one more CNAME record.
export function formatDomain(subdomain, root = FALLBACK_ROOT_DOMAIN) {
  const clean = sanitiseLabel(subdomain)
  const base = sanitiseRoot(root)
  if (!clean || !base) return null
  return `${clean}.${base}`
}

// Vercel project names are unique per account, and the old name was
// `storefront-${label}` — so "acme" on a second root domain collided with "acme"
// on the first and the deploy died on "project name already taken". The root is
// part of the name so the FQDN determines it.
//
// Only affects NEW projects: an existing shop redeploys against its stored
// vercel_project_id and never re-derives this name.
export function projectNameFor(label, root = FALLBACK_ROOT_DOMAIN) {
  const clean = sanitiseLabel(label)
  if (!clean) return null
  const rootSlug = sanitiseRoot(root).replace(/\./g, '-')
  const name = rootSlug ? `storefront-${clean}-${rootSlug}` : `storefront-${clean}`
  if (name.length <= 60) return name
  // Truncating the assembled string would cut the tail off — including the part
  // that makes it unique — so shorten the LABEL to leave room for a hash of the
  // full FQDN instead. Slicing the result would have silently merged two
  // different domains back into the same project name.
  const digest = createHash('sha1').update(`${clean}.${sanitiseRoot(root)}`).digest('hex').slice(0, 8)
  const budget = 60 - 'storefront-'.length - 1 - digest.length
  return `storefront-${clean.slice(0, Math.max(1, budget))}-${digest}`
}

export function validateSubdomain(subdomain) {
  if (!subdomain || subdomain.length < 2) return 'Subdomain must be at least 2 characters'
  if (!/^[a-z0-9][a-z0-9-]{0,60}[a-z0-9]$/i.test(subdomain)) {
    return 'Subdomain can only contain letters, numbers, and hyphens'
  }
  if (RESERVED_SUBDOMAINS.has(subdomain.toLowerCase())) {
    return 'That subdomain is reserved. Choose another name.'
  }
  return null
}
