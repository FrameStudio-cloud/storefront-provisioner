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
// DEFAULT_PLATFORM_DOMAIN in website-url.js and PLATFORM_ROOT_DOMAIN in the Keel app.
export const FALLBACK_ROOT_DOMAIN = 'keel.framestudio.co.ke'

// Build the FQDN for a storefront label. The root is a parameter so owning more
// domains is a database insert, not a code change — *.keel.framestudio.co.ke is
// CNAMEd to cname.vercel-dns.com, and a new root needs one more CNAME record.
export function formatDomain(subdomain, root = FALLBACK_ROOT_DOMAIN) {
  const clean = String(subdomain || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
  // trim() before the dot strip, or " .example.com. " keeps its spaces and
  // becomes "shop. .example.com. "
  const base = String(root || '')
    .toLowerCase()
    .trim()
    .replace(/^\.+|\.+$/g, '')
  if (!clean || !base) return null
  return `${clean}.${base}`
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
