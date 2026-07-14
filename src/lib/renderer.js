import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { join, extname, relative } from 'path'
import { fileURLToPath } from 'url'
import ejs from 'ejs'

const __dirname = join(fileURLToPath(import.meta.url), '..')

function walkDir(dir, baseDir = dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = relative(baseDir, full)
    if (statSync(full).isDirectory()) {
      files.push(...walkDir(full, baseDir))
    } else {
      files.push({ full, rel })
    }
  }
  return files
}

function normalizePhone(phone) {
  if (!phone) return ''
  let normalized = phone.replace(/[\s\-\(\)\+]/g, '')
  if (normalized.startsWith('0')) normalized = '254' + normalized.slice(1)
  if (!normalized.startsWith('254')) normalized = '254' + normalized
  return normalized
}

function mapToConfig(raw) {
  const { shop, settings, catalogue, banners } = raw
  const name = settings.store_name || shop.name || ''
  const nameParts = name.split(/[\s/]/).filter(Boolean)
  const nameAccent = settings.name_accent || (nameParts.length > 1 ? nameParts.pop() : '')

  const slides = (banners || [])
    .filter((b) => b.type === 'hero' && b.active !== false)
    .map((b) => ({
      image: b.image_url || '',
      tag: b.title || '',
      title: b.subtitle || '',
      description: b.message || '',
      buttonText: 'Shop Now',
      buttonLink: '#catalogue',
    }))

  const announcements = (banners || [])
    .filter((b) => ['sale', 'info', 'alert'].includes(b.type) && b.active !== false)
    .map((b) => {
      let type = 'info'
      const t = (b.title || '').toLowerCase()
      if (t.includes('sale') || t.includes('offer')) type = 'sale'
      else if (t.includes('warn') || t.includes('alert')) type = 'warning'
      return { text: b.message || b.title || '', type }
    })

  const rawHours = settings.business_hours || {}
  const hours = Object.entries(rawHours)
    .filter(([, v]) => v && v.open && v.close)
    .map(([day, v]) => ({
      day: day.charAt(0).toUpperCase() + day.slice(1, 3),
      hours: `${v.open} - ${v.close}`,
    }))

  return {
    name,
    nameAccent,
    tagline: settings.tagline || settings.description || '',
    description: settings.description || '',
    about: settings.about || settings.description || '',
    whatsapp: normalizePhone(settings.whatsapp || ''),
    phone: normalizePhone(settings.store_phone || ''),
    email: settings.store_email || '',
    location: settings.store_address || '',
    address: settings.store_address || '',
    currency: settings.currency_symbol || 'KSh',
    websiteUrl: settings.website_url || '',
    hours,
    primaryColor: settings.primary_color || '#000000',
    secondaryColor: settings.secondary_color || '#4f46e5',
    accentColor: settings.accent_color || '#f59e0b',
    slides,
    categories: [...new Set((catalogue || []).map((item) => item.category).filter(Boolean))],
    catalogue: (catalogue || []).map((item) => ({
      id: item.id,
      variant: item.type || 'product',
      category: item.category || '',
      title: item.name,
      description: item.description || '',
      image: item.image ? { src: item.image } : null,
      price: item.price || 0,
      badge: item.badge || '',
      available: item.available !== false,
      featured: item.featured || false,
      specs: item.specs || [],
      variants: Array.isArray(item.variants) ? item.variants : [],
      includes: item.includes || [],
    })),
    announcements,
    socialLinks: [
      ...(settings.instagram ? [{ icon: 'instagram', href: `https://instagram.com/${settings.instagram.replace(/^@/, '')}`, label: 'Instagram' }] : []),
      ...(settings.facebook ? [{ icon: 'facebook', href: settings.facebook.startsWith('http') ? settings.facebook : `https://facebook.com/${settings.facebook}`, label: 'Facebook' }] : []),
      ...(settings.tiktok ? [{ icon: 'tiktok', href: settings.tiktok.startsWith('http') ? settings.tiktok : `https://tiktok.com/@${settings.tiktok.replace(/^@/, '')}`, label: 'TikTok' }] : []),
    ],
    developerName: 'Framestudio',
    developerWhatsapp: '254793302518',
  }
}

export function renderTemplate(templateDir, rawData) {
  const config = mapToConfig(rawData)
  const files = walkDir(templateDir)
  const output = {}

  for (const { full, rel } of files) {
    if (!rel.endsWith('.ejs')) {
      output[rel] = readFileSync(full, 'utf-8')
      continue
    }

    const content = readFileSync(full, 'utf-8')
    const rendered = ejs.render(content, config)
    const outPath = rel.replace(/\.ejs$/, '')
    output[outPath] = rendered
  }

  return output
}
