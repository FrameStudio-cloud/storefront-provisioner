// Writes a rendered sections build to disk so it can be compiled for real.
//   node scripts/emit-sections-build.mjs [outDir] [sectionsDir]
//
// A coherence check on the generated text is not the same as a compiler agreeing
// it builds. This exists so "does the custom builder actually work?" is answered
// by vite, not by inspection.

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const imp = (p) => import(pathToFileURL(p).href)

const OUT = process.argv[2] || join(ROOT, '.tmp-sections-build')
const SECTIONS_DIR =
  process.argv[3] || process.env.SECTIONS_DIR || join(ROOT, '..', 'storefront-sections', 'sections')

const { renderFromSections } = await imp(join(ROOT, 'src/lib/renderer.js'))
const { getTemplate } = await imp(join(ROOT, 'src/templates/registry.js'))

const TEMPLATES_DIR = join(ROOT, 'src', 'templates')

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

const SECTIONS = [
  'announcements', 'navbar/transparent', 'hero/slideshow', 'about',
  'categories/strip', 'catalogue/grid', 'footer/4-column',
  'whatsapp-float', 'back-to-top',
  'catalogue/product-detail', 'catalogue/related',
]

const productOnly = ['catalogue/product-detail', 'catalogue/related']
const bothPages = ['announcements', 'whatsapp-float', 'back-to-top']
const blueprint = {
  home: SECTIONS.filter((id) => !productOnly.includes(id)),
  product: SECTIONS.filter(
    (id) => productOnly.includes(id) || bothPages.includes(id) ||
      id.startsWith('navbar/') || id.startsWith('footer/')
  ),
}

const template = getTemplate('custom')
const baseDir = template?.base && existsSync(join(TEMPLATES_DIR, template.base))
  ? join(TEMPLATES_DIR, template.base)
  : null

if (!baseDir) {
  console.error('  custom template has no usable base — the scaffold would be missing')
  process.exit(2)
}

const out = renderFromSections(
  join(TEMPLATES_DIR, 'classic'),
  SECTIONS_DIR,
  SHOP,
  blueprint,
  baseDir,
  { rootDomain: 'keel.framestudio.co.ke', domain: 'test-shop.keel.framestudio.co.ke' }
)

rmSync(OUT, { recursive: true, force: true })
let n = 0
for (const [path, content] of Object.entries(out)) {
  const dest = join(OUT, path)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, content)
  n++
}
console.log(`  wrote ${n} files to ${OUT}`)
console.log(`  run:  cd "${OUT}" && npm install && npx vite build`)
