// Renders a sections build exactly as a deploy would, then checks the emitted
// project is actually buildable — imports resolve, dependencies are declared, and
// the product page has something on it.
//
//   node scripts/verify-sections-build.mjs
//
// Exists because the custom builder's failure was invisible from the provisioner:
// it emitted a project that looked fine and then failed at Vercel with
// "failed to resolve import './config/site'". Nothing in this repo asserted the
// output was coherent, so D1 shipped and D2 shipped alongside it.

import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// ESM dynamic import of an absolute Windows path needs a file:// URL.
const imp = (p) => import(pathToFileURL(p).href)

const { renderFromSections, SECTION_REGISTRY } = await imp(join(ROOT, 'src/lib/renderer.js'))
const { getTemplate } = await imp(join(ROOT, 'src/templates/registry.js'))

const TEMPLATES_DIR = join(ROOT, 'src', 'templates')
const SECTIONS_DIR = process.env.SECTIONS_DIR || join(ROOT, '..', 'storefront-sections', 'sections')

// Stands in for fetchShopData(). Shape matches what shop-fetcher returns.
const SHOP = {
  shop: { id: '11111111-1111-1111-1111-111111111111', name: 'Test Shop', slug: 'test-shop' },
  settings: {
    store_name: 'Test Shop',
    tagline: 'Testing',
    whatsapp: '+254700000000',
    website_url: 'https://example.vercel.app/',
  },
  catalogue: [
    { id: 'p1', title: 'Shoes', description: 'Nice', price: 2500, available: true, featured: true, category: 'Fashion', image: null, specs: null, includes: null, variants: null },
    { id: 'p2', title: 'Bag', description: 'Tidy', price: 1800, available: true, featured: false, category: 'Fashion', image: null, specs: null, includes: null, variants: null },
  ],
  banners: [{ id: 'b1', type: 'hero', active: true, subtitle: 'New', title: 'Welcome', message: 'Come in', image_url: null }],
}

// buildBlueprint lives in deploy.js, which imports vercel.js — and that
// process.exits when VERCEL_TOKEN is absent. Mirrored here rather than importing a
// module that cannot load without credentials. Keep in step with the original.
function blueprintFor(sectionIds) {
  const productOnly = ['catalogue/product-detail', 'catalogue/related']
  const bothPages = ['announcements', 'whatsapp-float', 'back-to-top']
  return {
    home: sectionIds.filter((id) => !productOnly.includes(id)),
    product: sectionIds.filter(
      (id) => productOnly.includes(id) || bothPages.includes(id) || id.startsWith('navbar/') || id.startsWith('footer/')
    ),
  }
}

const SECTION_SETS = {
  'classic-equivalent': [
    'announcements', 'navbar/transparent', 'hero/slideshow', 'about',
    'catalogue/grid', 'footer/4-column', 'whatsapp-float', 'back-to-top',
    'catalogue/product-detail', 'catalogue/related',
  ],
  'minimal-equivalent': [
    'navbar/solid', 'hero/static', 'catalogue/grid', 'footer/minimal',
    'whatsapp-float', 'back-to-top', 'catalogue/product-detail', 'catalogue/related',
  ],
}

if (!existsSync(SECTIONS_DIR)) {
  console.error(`\n  sections repo not found at ${SECTIONS_DIR}`)
  console.error('  Set SECTIONS_DIR, or run:  git clone <sections repo> ../storefront-sections\n')
  process.exit(2)
}

let failures = 0
const fail = (set, msg) => { failures++; console.log(`   ✗ ${msg}`) }
const pass = (msg) => console.log(`   ✓ ${msg}`)

for (const [name, sections] of Object.entries(SECTION_SETS)) {
  console.log(`\n── ${name} (${sections.length} sections) ──`)

  const template = getTemplate('custom')
  if (!template) { fail(name, 'no custom template in registry'); continue }
  if (!template.base) { fail(name, 'custom has no base, so the scaffold would be missing'); continue }
  pass(`registry: custom.base = ${template.base}`)

  const baseTemplateId = 'classic'
  const baseDir = existsSync(join(TEMPLATES_DIR, template.base)) ? join(TEMPLATES_DIR, template.base) : null
  if (!baseDir) { fail(name, `base dir ${template.base} does not exist`); continue }

  // D1 regression guard: a sections build must never resolve to a variant dir.
  const toolchainForSections = null
  const out = renderFromSections(
    join(TEMPLATES_DIR, baseTemplateId),
    SECTIONS_DIR,
    SHOP,
    blueprintFor(sections),
    baseDir,
    { rootDomain: 'keel.framestudio.co.ke', domain: 'test-shop.keel.framestudio.co.ke', toolchain: { ui: toolchainForSections } }
  )

  const files = Object.keys(out).map((k) => k.replace(/\\/g, '/'))
  console.log(`   files emitted: ${files.length}`)

  // --- D1: the import the generated App.jsx depends on must exist -------------
  const appJsx = out['src/App.jsx']
  if (!appJsx) {
    fail(name, 'no src/App.jsx emitted')
  } else {
    const imports = [...appJsx.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1])
    const local = imports.filter((i) => i.startsWith('.'))
    for (const spec of local) {
      // The specifier may or may not already carry an extension.
      const bare = spec.replace(/^\.\//, '').replace(/\.(jsx?|ejs)$/, '')
      const candidates = [
        `src/${bare}.js`, `src/${bare}.jsx`,
        `src/${bare}/index.js`, `src/${bare}/index.jsx`,
      ]
      const ok = candidates.some((c) => files.includes(c))
      if (!ok) fail(name, `App.jsx imports '${spec}' but nothing emits it`)
    }
    if (local.length) pass(`all ${local.length} relative import(s) in App.jsx resolve to an emitted file`)

    // Each section is now its own module, so the local name in App.jsx is an
    // alias derived from the id, not the export name. Recover it from the import.
    const localNameFor = (id) => {
      const mod = `./sections/${id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.jsx`
      const re = new RegExp(`import \\{[^}]*\\b([A-Za-z0-9_]+)(?:\\s+as\\s+([A-Za-z0-9_]+))?[^}]*\\}\\s+from\\s+'${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`)
      const m = appJsx.match(re)
      if (!m) return null
      return m[2] || m[1]
    }

    // D2: the product page must actually render a product.
    const productFn = (appJsx.match(/function ProductPage\(\)[\s\S]*?\n\}/) || [''])[0]
    const detailLocal = localNameFor('catalogue/product-detail')
    if (!detailLocal) {
      fail(name, 'App.jsx does not import catalogue/product-detail')
    } else if (new RegExp(`<${detailLocal}\\s*/>`).test(productFn)) {
      pass(`product page renders <${detailLocal} />`)
      const modFile = files.find((f) => f.endsWith('catalogue-product-detail.jsx'))
      const src = modFile ? out[modFile] : ''
      if (new RegExp(`export\\s+(function|const|class)\\s+${SECTION_REGISTRY['catalogue/product-detail']}\\b`).test(src)) {
        pass('and that module really exports the registered component')
      } else {
        fail(name, `${modFile} does not export ${SECTION_REGISTRY['catalogue/product-detail']}`)
      }
    } else {
      fail(name, `product page does not render <${detailLocal} /> — it would be empty`)
    }
    const relatedLocal = localNameFor('catalogue/related')
    if (relatedLocal && new RegExp(`<${relatedLocal}\\s*/>`).test(productFn)) {
      pass(`product page renders <${relatedLocal} />`)
    } else {
      fail(name, 'product page does not render catalogue/related')
    }

    // Every icon used must be imported somewhere. Sections now import their own.
    const allJsx = files.filter((f) => f.endsWith('.jsx')).map((f) => out[f]).join('\n')
    const importedAnywhere = new Set()
    for (const src of [appJsx, allJsx]) {
      for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
        for (const part of m[1].split(',')) {
          const bits = part.trim().split(/\s+as\s+/)
          if (bits[0]) importedAnywhere.add(bits[0].trim())
          // `import { Nav as NavbarTransparent }` puts NavbarTransparent in the
          // file's scope, not Nav. Both names have to be known locally.
          if (bits[1]) importedAnywhere.add(bits[1].trim())
        }
      }
      for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) importedAnywhere.add(m[1])
    }
    // Section files keep their `export` keyword now that they are real modules,
    // so the declaration match has to allow for it. `announcements` exports both
    // AnnouncementBar and Announcements; only the latter is registered, and the
    // former is used internally. Declarations may be indented (footer/4-column
    // does `const Icon = SOCIAL_ICONS[...]` inside a map callback), so allow
    // leading whitespace rather than only column zero.
    const localFns = new Set([
      ...allJsx.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9]*)/g),
    ].map((m) => m[1]))
    const usedTags = new Set()
    for (const m of allJsx.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) usedTags.add(m[1])
    const undeclared = [...usedTags].filter((n) => !localFns.has(n) && !importedAnywhere.has(n))
    if (undeclared.length) fail(name, `component(s)/icon(s) used but never imported or declared: ${undeclared.join(', ')}`)
    else pass('every component and icon used is imported or declared')
  }

  // --- the site's own data must be present -----------------------------------
  if (files.includes('src/config/site.js')) pass('src/config/site.js emitted (the one D1 lost)')
  else fail(name, 'src/config/site.js missing — every generated App.jsx imports it')
  if (files.includes('src/main.jsx')) pass('src/main.jsx emitted')
  else fail(name, 'src/main.jsx missing')

  // --- declared dependencies must cover what the sections import ------------
  const pkgKey = files.find((f) => f === 'package.json')
  if (pkgKey) {
    const pkg = JSON.parse(out[pkgKey])
    const deps = Object.keys(pkg.dependencies || {})
    const needed = new Set()
    for (const m of appJsx.matchAll(/from ['"]([^.'"][^'"]*)['"]/g)) {
      const spec = m[1]
      if (spec.startsWith('@')) needed.add(spec.split('/').slice(0, 2).join('/'))
      else needed.add(spec.split('/')[0])
    }
    const missingDeps = [...needed].filter((d) => !deps.includes(d))
    if (missingDeps.length) fail(name, `package.json is missing ${missingDeps.join(', ')} — used by the generated App.jsx`)
    else pass(`package.json declares everything the app imports (${deps.length} deps)`)
  } else {
    fail(name, 'no package.json emitted')
  }

  // --- double-scheme / doubled-root regressions -----------------------------
  if (/https:\/\/https:\/\//.test(JSON.stringify(out))) fail(name, 'emitted a doubled URL scheme')
  if (/\.co\.ke\.keel\./.test(JSON.stringify(out))) fail(name, 'emitted a doubled domain root')
}

console.log(`\n${failures === 0 ? 'all checks passed' : failures + ' check(s) failed'}\n`)
process.exit(failures > 0 ? 1 : 0)
