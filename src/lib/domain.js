export function formatDomain(subdomain) {
  const clean = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  return `${clean}.keel.framestudio.co.ke`
}

export function validateSubdomain(subdomain) {
  if (!subdomain || subdomain.length < 2) return 'Subdomain must be at least 2 characters'
  if (!/^[a-z0-9][a-z0-9-]{0,60}[a-z0-9]$/i.test(subdomain)) {
    return 'Subdomain can only contain letters, numbers, and hyphens'
  }
  return null
}
