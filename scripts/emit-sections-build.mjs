// Writes a rendered build to disk so it can be compiled for real.
//   node scripts/emit-sections-build.mjs [outDir] [templateId]
//
// A coherence check on the generated text is not the same as a compiler agreeing
// it builds. This exists so "does this template actually work?" is answered by
// vite, not by inspection. Pass a template id (default: all of them, one at a
// time into <outDir>/<id>).

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const imp = (p) => import(pathToFileURL(p).href)

const BASE_OUT = process.argv[2] || join(ROOT, '.tmp-sections-build')
const ONLY = process.argv[3] || null
const SECTIONS_DIR =
  process.env.SECTIONS_DIR || join(ROOT, '..', 'storefront-sections', 'sections')

const { renderFromSections } = await imp(join(ROOT, 'src/lib/renderer.js'))
const { getTemplate, listTemplates } = await imp(join(ROOT, 'src/templates/registry.js'))

const TEMPLATES_DIR = join(ROOT, 'src', 'templates')
const SCAFFOLD = '_shared'

const SHOP = {
  shop: { id: '11111111-1111-1111-1111-111111111111', name: 'Test Shop', slug: 'test-shop' },
  settings: {
    store_name: 'Test Shop', tagline: 'Testing', whatsapp: '+254700000000',
    email: 'hi@example.com', location: 'Nairobi', hours: null,
    website_url: 'https://example.vercel.app/',
    primary_color: '#0f766e', secondary_color: '#4f46e5', accent_color: '#f59e0b',
  },
  catalogue: [
    { id: 'p1', title: 'Shoes', description: 'Nice shoes', price: 2500, available: true, featured: true, category: 'Fashion', image: null, specs: [['Size','42']], includes: ['Box'], variants: null, badge: null },
    { id: 'p2', title: 'Bag', description: 'Tidy bag', price: 1800, available: true, featured: false, category: 'Fashion', image: null, specs: null, includes: null, variants: null, badge: null },
  ],
  banners: [
    { id: 'b1', type: 'hero', active: true, subtitle: 'New', title: 'Welcome', message: 'Come in', image_url: null },
    { id: 'b2', type: 'sale', active: true, subtitle: '', title: 'Sale on', message: '20% off', image_url: null },
  ],
}

// buildBlueprint's rule, mirrored. deploy.js owns the real one; this cannot import
// it because deploy.js pulls in vercel.js, which exits without VERCEL_TOKEN.
const productOnly = ['catalogue/product-detail', 'catalogue/related']
const bothPages = ['announcements', 'whatsapp-float', 'back-to-top']

const baseDir = existsSync(join(TEMPLATES_DIR, SCAFFOLD))
  ? join(TEMPLATES_DIR, SCAFFOLD)
  : null

if (!baseDir) {
  console.error(`  project scaffold "${SCAFFOLD}" is missing from src/templates`)
  process.exit(2)
}

const ids = ONLY ? [ONLY] : listTemplates().filter((t) => t.sections?.length).map((t) => t.id)

for (const id of ids) {
  const template = getTemplate(id)
  const sections = template.sections || []
  if (!sections.length) {
    console.log(`  ${id}: no sections, skipped`)
    continue
  }
  const blueprint = {
    home: sections.filter((s) => !productOnly.includes(s)),
    product: sections.filter(
      (s) => productOnly.includes(s) || bothPages.includes(s) ||
        s.startsWith('navbar/') || s.startsWith('footer/')
    ),
  }

  const out = renderFromSections(
    '_shared',
    SECTIONS_DIR,
    SHOP,
    blueprint,
    null,
    {
      rootDomain: 'keel.framestudio.co.ke',
      domain: 'test-shop.keel.framestudio.co.ke',
      theme_name: template.theme,
      titleSuffix: template.titleSuffix,
      schemaType: template.schemaType,
      fontHref: template.fontHref,
    }
  )

  const dest = ONLY ? BASE_OUT : join(BASE_OUT, id)
  rmSync(dest, { recursive: true, force: true })
  let n = 0
  for (const [path, content] of Object.entries(out)) {
    const target = join(dest, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
    n++
  }
  console.log(`  ${id.padEnd(10)} ${String(n).padStart(3)} files  theme=${template.theme}  -> ${dest}`)
}

console.log(`\n  for each:  cd <dir> && npm install && npx vite build`)
