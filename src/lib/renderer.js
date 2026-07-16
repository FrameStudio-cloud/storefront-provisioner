import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
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

const SECTION_REGISTRY = {
  'navbar/transparent': 'Nav',
  'navbar/solid': 'Nav',
  'hero/slideshow': 'HeroSlideshow',
  'hero/static': 'HeroStatic',
  'hero/split': 'HeroSplit',
  'about': 'AboutSection',
  'announcements': 'Announcements',
  'back-to-top': 'BackToTop',
  'catalogue/carousel': 'Carousel',
  'catalogue/grid': 'CatalogueGrid',
  'catalogue/product-detail': 'ProductDetail',
  'catalogue/related': 'RelatedProducts',
  'categories/strip': 'CategoryStrip',
  'featured-collection': 'FeaturedCollection',
  'footer/4-column': 'Footer',
  'footer/minimal': 'FooterMinimal',
  'whatsapp-float': 'WhatsAppFloat',
}

const ALL_ICONS = [
  'X', 'List', 'CaretLeft', 'CaretRight', 'MapPin',
  'Envelope', 'Clock', 'CaretUp', 'MagnifyingGlass', 'WhatsappLogo',
  'InstagramLogo', 'FacebookLogo', 'Globe', 'Phone',
]

const SHARED_DEPS = ['shared/Container', 'shared/ImageWithFallback']

function composeAppJsx(sectionsDir, blueprint) {
  let allIds = [...new Set([...(blueprint.home || []), ...(blueprint.product || [])])]

  // Auto-include shared sections if any non-shared sections are present
  const hasNonShared = allIds.some(id => !id.startsWith('shared/'))
  if (hasNonShared) {
    for (const dep of SHARED_DEPS) {
      if (!allIds.includes(dep)) allIds.push(dep)
    }
  }

  const componentBodies = []
  for (const id of allIds) {
    const componentPath = join(sectionsDir, ...id.split('/'), 'component.jsx.ejs')
    let source
    try { source = readFileSync(componentPath, 'utf-8') } catch { continue }
    let body = source.replace(/^import .*$/gm, '').trim()
    body = body.replace(/export function /g, 'function ').replace(/export const /g, 'const ')
    componentBodies.push(body)
  }

  const imports = [
    `import { useState, useEffect, useCallback, useMemo } from 'react'`,
    `import { Routes, Route, useParams, useNavigate } from 'react-router-dom'`,
    `import { ${ALL_ICONS.join(', ')} } from '@phosphor-icons/react'`,
    `import shopConfig from './config/site'`,
    ``,
    `const c = shopConfig`,
  ].join('\n')

  function renderPageJsx(sectionIds) {
    return (sectionIds || [])
      .map(id => {
        const name = SECTION_REGISTRY[id]
        return name ? `      <${name} />` : ''
      })
      .filter(Boolean)
      .join('\n')
  }

  const appJsx = `${imports}
${componentBodies.join('\n\n')}

function HomePage() {
  return (
    <div className="min-h-screen bg-white">
${renderPageJsx(blueprint.home)}
    </div>
  )
}

function ProductPage() {
  return (
    <div className="min-h-screen bg-white">
${renderPageJsx(blueprint.product)}
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/product/:id" element={<ProductPage />} />
    </Routes>
  )
}
`
  return appJsx
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
      tag: b.subtitle || '',
      title: b.title || '',
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

function composeStylesCss() {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

html {
  scroll-behavior: smooth;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fade-scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slide-in-right {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.animate-fade-in {
  animation: fade-in 0.4s ease-out;
}

.animate-fade-scale-in {
  animation: fade-scale-in 0.3s ease-out;
}

.animate-slide-up {
  animation: slide-up 0.5s ease-out;
}

.animate-slide-in-right {
  animation: slide-in-right 0.25s ease-out;
}

.hero-slide {
  animation: fade-scale-in 0.6s ease-out;
}

.whatsapp-float {
  animation: slide-up 0.4s ease-out 0.3s both;
}

.back-to-top {
  animation: fade-in 0.3s ease-out;
}

.product-card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.product-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px -8px rgba(0, 0, 0, 0.1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  html {
    scroll-behavior: auto;
  }
}`
}

export function renderTemplate(templateDir, rawData, baseTemplateDir) {
  const config = mapToConfig(rawData)
  const output = {}

  // Walk base template dir first (if provided), then template dir (overrides)
  const dirs = baseTemplateDir ? [baseTemplateDir, templateDir] : [templateDir]
  const seen = new Set()
  for (const dir of dirs) {
    const files = walkDir(dir)
    for (const { full, rel } of files) {
      const normalized = rel.replace(/\\/g, '/')
      if (seen.has(normalized)) continue
      seen.add(normalized)

      if (!rel.endsWith('.ejs')) {
        output[rel] = readFileSync(full, 'utf-8')
        continue
      }

      const content = readFileSync(full, 'utf-8')
      const rendered = ejs.render(content, config)
      const outPath = rel.replace(/\.ejs$/, '')
      output[outPath] = rendered
    }
  }

  return output
}

export function renderFromSections(baseTemplateDir, sectionsDir, rawData, blueprint, sectionBaseDir) {
  const config = mapToConfig(rawData)
  const appJsxSource = composeAppJsx(sectionsDir, blueprint)
  const stylesCssSource = composeStylesCss()

  const output = {}

  // Walk base + sectionBase dirs (skip App.jsx.ejs / styles.css.ejs)
  const dirs = sectionBaseDir ? [sectionBaseDir, baseTemplateDir] : [baseTemplateDir]
  const seen = new Set()
  for (const dir of dirs) {
    const files = walkDir(dir)
    for (const { full, rel } of files) {
      const normalized = rel.replace(/\\/g, '/')
      if (seen.has(normalized)) continue
      seen.add(normalized)

      const skipList = ['src/App.jsx.ejs', 'src/App.jsx', 'src/renderer.js', 'src/renderer.js.ejs', 'src/styles.css.ejs', 'src/styles.css']
      if (skipList.includes(normalized)) continue

      if (!rel.endsWith('.ejs')) {
        output[rel] = readFileSync(full, 'utf-8')
        continue
      }

      const content = readFileSync(full, 'utf-8')
      const rendered = ejs.render(content, config)
      const outPath = rel.replace(/\.ejs$/, '')
      output[outPath] = rendered
    }
  }

  // Override with generated files (App.jsx is plain JSX, not EJS)
  output['src/App.jsx'] = appJsxSource
  output['src/styles.css'] = stylesCssSource

  return output
}
