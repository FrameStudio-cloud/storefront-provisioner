import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import ejs from 'ejs'
import { resolveTheme, grayScaleFor, DEFAULT_THEME } from './themes.js'

const __dirname = join(fileURLToPath(import.meta.url), '..')

// Only one directory remains under src/templates: the _shared scaffold. Templates
// are data now, so a template id resolves to no directory at all.
const TEMPLATES_DIR = join(__dirname, '..', 'templates')

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

export const SECTION_REGISTRY = {
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

// Every section becomes its OWN MODULE rather than a slice of one big file.
//
// This used to concatenate every selected section's source into a single
// src/App.jsx, stripping import lines with a regex and demoting `export` to
// nothing. Because that put all the sections in one scope, any two that declared
// the same top-level name collided — and 7 of the 19 declare `const COLORS` — so
// the build died with "The symbol COLORS has already been declared". The wizard
// could not produce a working site: catalogue/grid, catalogue/product-detail and
// catalogue/related all declare it, and product-detail is added automatically
// whenever a catalogue is chosen.
//
// Emitting one file per section removes the whole class of problem rather than
// patching it. It also retires three other hacks at once: the regex that stripped
// imports (sections keep their own, which is why no import allowlist is needed),
// the ALL_ICONS list (each section already imports the icons it uses), and the
// shared/Container import that pointed at a path which never existed in the
// output and only worked because the line was deleted before it mattered.
//
// And a section is now a real file with a real module boundary, which is what
// makes it safe for someone — or something — to add a new one.

function sectionModulePath(id) {
  return `src/sections/${id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.jsx`
}

// `catalogue/product-detail` -> `CatalogueProductDetail`. Unique even when two
// sections export the same name (navbar/transparent and navbar/solid are both
// `Nav`), because a second collision gets a numeric suffix.
function sectionAlias(id, used) {
  const base = id
    .split('/')
    .map((part) => part.split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(''))
    .join('') || 'Section'
  let name = base
  let n = 2
  while (used.has(name)) name = `${base}${n++}`
  used.add(name)
  return name
}

function composeSectionModules(sectionsDir, blueprint) {
  const modules = {}
  const problems = []

  const home = blueprint.home || []
  const product = blueprint.product || []
  const allIds = [...new Set([...home, ...product])]

  // Auto-include shared sections if any non-shared sections are present
  const hasNonShared = allIds.some((id) => !id.startsWith('shared/'))
  if (hasNonShared) {
    for (const dep of SHARED_DEPS) {
      if (!allIds.includes(dep)) allIds.push(dep);
    }
  }

  const used = new Set()
  const aliases = new Map()   // section id -> local alias
  const importLines = []

  for (const id of allIds) {
    const exportName = SECTION_REGISTRY[id]
    const isShared = id.startsWith('shared/')

    if (!isShared && !exportName) {
      // Previously dropped with no log at all, so a typo or a removed section
      // produced a silently shorter page and a "successful" deploy.
      problems.push(`Unknown section "${id}" — not in SECTION_REGISTRY, skipped`)
      continue
    }

    const componentPath = join(sectionsDir, ...id.split('/'), 'component.jsx.ejs')
    let source
    try {
      source = readFileSync(componentPath, 'utf-8')
    } catch {
      if (!isShared) problems.push(`Section "${id}" has no component.jsx.ejs at ${componentPath} — skipped`)
      continue
    }

    // Point the shared imports at the flat module we are about to emit. Both
    // `../shared/…` (one level deep) and `../../shared/…` (two) appear in the repo.
    const body = source.replace(
      /(["'])(\.\.\/)+shared\/([A-Za-z0-9_]+)\/component\.jsx\.ejs\1/g,
      (_m, q, _dots, name) => `${q}./shared-${name}${q}`
    )

    // Section files reference a bare `c` (the shop config). In a single file that
    // was a module-level const; as separate modules each one imports it directly,
    // which is what the sections were always reaching for. config/site.js has a
    // default export, so the specifier matches what App.jsx used to do.
    const withConfig = `import c from '../config/site'\n\n${body.replace(/^\s+/, '')}`

    modules[sectionModulePath(id)] = withConfig

    if (!isShared && exportName) {
      // Validate the registry against the source. schema.json's `name` is wrong in
      // 3 of 19 sections and is never read; SECTION_REGISTRY is the real contract,
      // so a drift between the two used to surface as a Vercel build error.
      if (!new RegExp(`export\\s+(function|const|class)\\s+${exportName}\\b`).test(source)) {
        problems.push(
          `Section "${id}" is registered as exporting "${exportName}" but ${componentPath} does not export it`
        )
        continue
      }
      const alias = sectionAlias(id, used)
      const modPath = sectionModulePath(id)
      aliases.set(id, { alias, exportName, path: modPath })
      const renamed = alias === exportName ? exportName : `${exportName} as ${alias}`
      importLines.push(`import { ${renamed} } from '${modPath.replace(/^src\//, './')}'`)
    }
  }

  const renderPage = (ids) =>
    (ids || [])
      .map((id) => {
        const entry = aliases.get(id)
        return entry ? `      <${entry.alias} />` : ''
      })
      .filter(Boolean)
      .join('\n')

  const appJsx = `import { Routes, Route } from 'react-router-dom'
${importLines.join('\n')}

function HomePage() {
  return (
    <div className="min-h-screen bg-white">
${renderPage(home)}
    </div>
  )
}

function ProductPage() {
  return (
    <div className="min-h-screen bg-white">
${renderPage(product)}
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

  return { modules, appJsx, problems }
}

function normalizePhone(phone) {
  if (!phone) return ''
  let normalized = phone.replace(/[\s\-\(\)\+]/g, '')
  if (normalized.startsWith('0')) normalized = '254' + normalized.slice(1)
  if (!normalized.startsWith('254')) normalized = '254' + normalized
  return normalized
}

// Reduce whatever the shop has stored to a bare host, so templates can build an
// absolute URL without worrying about a scheme or a trailing slash.
export function hostOf(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// The address this storefront is actually served on, in preference order:
// the FQDN the deploy job just claimed, then the shop's stored website_url, then
// a slug of the shop name under the platform root.
//
// The templates used to do this themselves as
// `websiteUrl || name.toLowerCase()... + '.keel.framestudio.co.ke'` and prefix it
// with "https://" — but website_url is stored WITH a scheme, so that produced
// canonical and og:url values of "https://https://shop.example/".
export function resolveSiteHost({ domain, rootDomain, websiteUrl, name }) {
  const explicit = hostOf(domain)
  if (explicit) return explicit
  const stored = hostOf(websiteUrl)
  if (stored) return stored
  const root = String(rootDomain || '').toLowerCase().replace(/^\.+|\.+$/g, '')
  const slug = String(name || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  if (slug && root) return `${slug}.${root}`
  return ''
}

function mapToConfig(raw, configOverride) {
  const { shop, settings, catalogue, banners } = raw
  const name = settings.store_name || shop.name || ''
  const nameParts = name.split(/[\s/]/).filter(Boolean)
  const nameAccent = settings.name_accent || (nameParts.length > 1 ? nameParts.pop() : '')

  // The address this storefront is served on, decided once and reused for
  // siteHost, siteUrl and anything a template needs.
  const siteHost = resolveSiteHost({
    domain: configOverride?.domain,
    rootDomain: configOverride?.rootDomain,
    websiteUrl: settings.website_url,
    name,
  })

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
    rootDomain: String(configOverride?.rootDomain || '').toLowerCase().replace(/^\.+|\.+$/g, ''),
    siteHost,
    // Absolute, no double scheme. Templates use this verbatim.
    siteUrl: siteHost ? `https://${siteHost}` : '',
    hours,
    primaryColor: configOverride?.theme?.primary_color || settings.primary_color || '#000000',
    secondaryColor: configOverride?.theme?.secondary_color || settings.secondary_color || '#4f46e5',
    accentColor: configOverride?.theme?.accent_color || settings.accent_color || '#f59e0b',
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

    // The three values a template varies in the shared index.html. Everything
    // else about a design is its section list and theme. Defaults mean a render
    // with no template context still produces valid markup rather than throwing.
    titleSuffix: configOverride?.titleSuffix || '',
    schemaType: configOverride?.schemaType || 'Store',
    fontHref: configOverride?.fontHref || '',
  }
}

function composeStylesCss(theme) {
  const t = theme || resolveTheme(DEFAULT_THEME)
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

/* Theme variables. Every colour a section can reach comes through the gray scale,
   which tailwind.config.js maps onto these — so a theme is data, not a fork. */
:root {
  --sf-bg: ${t.bg};
  --sf-surface: ${t.surface};
  --sf-text: ${t.text};
  --sf-body: ${t.body};
  --sf-muted: ${t.muted};
  --sf-subtle: ${t.subtle};
  --sf-line: ${t.line};
  --sf-line-strong: ${t.lineStrong};
  --sf-brand: ${t.brand};
  --sf-brand-text: ${t.brandText};
  --sf-accent: ${t.accent};
  --sf-radius: ${t.radius};
  --sf-font: ${t.font};
  --sf-heading-font: ${t.headingFont};
}

html, body, #root {
  background-color: var(--sf-bg);
  color: var(--sf-text);
  font-family: var(--sf-font);
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--sf-heading-font);
  color: var(--sf-text);
}

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

// Generated per build so a theme applies without touching any section.
//
// The sections are written against Tailwind's default gray palette — text-gray-900,
// bg-gray-50, border-gray-100 and so on, which is what a developer reaches for by
// default. Rather than rewrite 19 section files to use CSS variables, the palette
// itself is remapped onto the theme. Status colours (green/amber/red) are
// deliberately NOT remapped: a brand theme should not change what "in stock" means.
function composeTailwindConfig(theme) {
  const t = theme || resolveTheme(DEFAULT_THEME)
  const gray = grayScaleFor(t)
  // Every value interpolated here must be ${}-substituted. An earlier version had
  // a bare `DEFAULT: t.radius`, so the generated config referenced an undefined
  // `t` and every build died in postcss with a parse error on the config's line 24.
  const grayLines = Object.entries(gray)
    .map(([k, v]) => `          ${k}: '${v}',`)
    .join('\n')
  return `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        gray: {
${grayLines}
        },
        brand: 'var(--sf-brand)',
        accent: 'var(--sf-accent)',
      },
      borderRadius: {
        DEFAULT: '${t.radius}',
        md: '${t.radius}',
        lg: '${t.radius}',
        xl: '${t.radius}',
        '2xl': '${t.radius}',
        '3xl': '${t.radius}',
      },
      fontFamily: {
        sans: 'var(--sf-font)',
        display: 'var(--sf-heading-font)',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        fadeScaleIn: { from: { opacity: '0', transform: 'scale(0.95)' }, to: { opacity: '1', transform: 'scale(1)' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(20px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
`
}

// renderTemplate is gone. It used to walk a template directory and EJS-render its
// own App.jsx.ejs — one per template, each carrying its own private copy of Nav,
// ProductCard, ProductDetail, Footer and the rest. With templates now expressed as
// a section list plus a theme, every site is produced by composeSectionModules, and
// keeping a second renderer would only invite the same drift that lost the
// #catalogue anchor from one side.
export function renderFromSections(templateDir, sectionsDir, rawData, blueprint, baseDir, configOverride) {
  const config = mapToConfig(rawData, configOverride)
  const theme = resolveTheme(configOverride?.theme_name || configOverride?.themeName)
  const { modules, appJsx, problems } = composeSectionModules(sectionsDir, blueprint)
  const stylesCssSource = composeStylesCss(theme)
  const tailwindConfigSource = composeTailwindConfig(theme)

  // Previously an unknown section, or a section whose file was missing, was
  // dropped with no output at all — the deploy then reported success with a
  // silently incomplete page. Surface it where the worker logs are.
  for (const problem of problems) console.warn(`[sections] ${problem}`)

  const output = {}

  // Accept either a bare name under src/templates ('_shared') or an absolute path,
  // so callers do not have to know where TEMPLATES_DIR lives. There is one
  // directory now — the scaffold — and nothing shadows anything, which is the
  // outcome of a long-lived bug: this used to walk [baseDir, templateDir] while
  // renderTemplate walked [templateDir, baseDir], harmless only because `custom`
  // had no base.
  const resolveDir = (dir) => (isAbsolute(dir) ? dir : join(TEMPLATES_DIR, dir))
  const dirs = baseDir ? [resolveDir(templateDir), resolveDir(baseDir)] : [resolveDir(templateDir)]
  const seen = new Set()
  for (const dir of dirs) {
    const files = walkDir(dir)
    for (const { full, rel } of files) {
      const normalized = rel.replace(/\\/g, '/')
      if (seen.has(normalized)) continue
      seen.add(normalized)

      // tailwind.config.js is generated so the theme's gray-scale remap applies.
      // Taking the template's copy would silently discard the theming.
      const skipList = [
        'src/App.jsx.ejs', 'src/App.jsx',
        'src/renderer.js', 'src/renderer.js.ejs',
        'src/styles.css.ejs', 'src/styles.css',
        'tailwind.config.js.ejs', 'tailwind.config.js',
      ]
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

  // Generated files. App.jsx and each section module are plain JSX, not EJS.
  // App.jsx and styles.css.ejs are skipped by the walk above, so nothing collides.
  output['src/App.jsx'] = appJsx
  output['src/styles.css'] = stylesCssSource
  output['tailwind.config.js'] = tailwindConfigSource
  for (const [path, source] of Object.entries(modules)) {
    output[path] = source
  }

  return output
}
