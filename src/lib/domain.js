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

export function formatDomain(subdomain) {
  const clean = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  return `${clean}.keel.framestudio.co.ke`
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
