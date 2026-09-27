// Renders the shared scaffold and inspects the emitted head tags.
//
// The point is the URL tags, not the styling. The five index.html.ejs files used
// to derive their own canonical host by slugifying the shop name and appending a
// hardcoded platform root, then prefix the result with "https://" — while
// store_settings.website_url is stored WITH a scheme. That combination emitted
//   <link rel="canonical" href="https://https://shop.example/">
// which is a broken canonical on every storefront.
//
// Those five files are now one, parameterised by titleSuffix / schemaType /
// fontHref. These tests run every catalogued design through it, which is the whole
// point of a template being data.
//
// node --test, no credentials needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostOf, resolveSiteHost } from './renderer.js'
import { formatDomain, FALLBACK_ROOT_DOMAIN } from './domain.js'
import { listTemplates } from '../templates/registry.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SECTIONS_DIR =
  process.env.SECTIONS_DIR || join(HERE, '..', '..', '..', 'storefront-sections', 'sections')

// Minimal shop payload — mapToConfig tolerates missing collections.
const SHOP = {
  shop: { id: '11111111-1111-1111-1111-111111111111', name: 'Campus Glow', slug: 'campus-glow' },
  settings: {
    store_name: 'Campus Glow',
    // The shape that actually lives in the database: scheme + trailing slash.
    website_url: 'https://kikoi-opal.vercel.app/',
  },
  catalogue: [],
  banners: [],
}

const grab = (html, re) => (html.match(re) || [])[1] || null

// There is one scaffold now, so render it through the same path a deploy uses and
// pull out index.html. The blueprint is empty on purpose: these tests are about the
// head, and an empty one keeps the output to the scaffold alone.
async function renderIndexHtml(configOverride) {
  const { renderFromSections } = await import('./renderer.js')
  const out = renderFromSections(
    '_shared', SECTIONS_DIR, SHOP, { home: [], product: [] }, null, configOverride
  )
  const key = Object.keys(out).find((k) => k.replace(/\\/g, '/').endsWith('index.html'))
  assert.ok(key, `scaffold produced no index.html (keys: ${Object.keys(out).join(', ')})`)
  return out[key]
}

test('hostOf reduces anything to a bare host', () => {
  assert.equal(hostOf('https://shop.example.com/'), 'shop.example.com')
  assert.equal(hostOf('shop.example.com'), 'shop.example.com')
  assert.equal(hostOf('https://Shop.Example.COM/path?x=1'), 'shop.example.com')
  assert.equal(hostOf(''), '')
  assert.equal(hostOf(null), '')
  assert.equal(hostOf('::::'), '')
})

test('resolveSiteHost prefers the domain the deploy job just claimed', () => {
  const host = resolveSiteHost({
    domain: 'campus-glow.keel.framestudio.co.ke',
    rootDomain: 'keel.framestudio.co.ke',
    websiteUrl: 'https://kikoi-opal.vercel.app/',
    name: 'Campus Glow',
  })
  assert.equal(host, 'campus-glow.keel.framestudio.co.ke')
})

test('resolveSiteHost falls back to website_url, then to slug + root', () => {
  assert.equal(
    resolveSiteHost({ rootDomain: 'myshop.co.ke', websiteUrl: 'https://kikoi-opal.vercel.app/', name: 'X' }),
    'kikoi-opal.vercel.app'
  )
  assert.equal(
    resolveSiteHost({ rootDomain: 'myshop.co.ke', websiteUrl: '', name: 'Campus Glow' }),
    'campus-glow.myshop.co.ke'
  )
  assert.equal(resolveSiteHost({ rootDomain: '', websiteUrl: '', name: '' }), '')
})

test('formatDomain takes a root, and still works with one argument', () => {
  assert.equal(formatDomain('acme', 'myshop.co.ke'), 'acme.myshop.co.ke')
  assert.equal(formatDomain('acme'), `acme.${FALLBACK_ROOT_DOMAIN}`)
  assert.equal(formatDomain('My Shop!', 'myshop.co.ke'), 'my-shop.myshop.co.ke')
  assert.equal(formatDomain('x', '  .MyShop.CO.KE.  '), 'x.myshop.co.ke')
  assert.equal(formatDomain('', 'myshop.co.ke'), null)
  assert.equal(formatDomain('acme', ''), null)
})

// The catalogued designs, minus `custom` whose sections arrive in the request.
const DESIGNS = listTemplates().filter((t) => t.sections.length > 0)

for (const template of DESIGNS) {
  test(`${template.id}: canonical, og:url and JSON-LD carry the claimed domain once`, async () => {
    const html = await renderIndexHtml({
      rootDomain: 'myshop.co.ke',
      domain: 'campus-glow.myshop.co.ke',
      titleSuffix: template.titleSuffix,
      schemaType: template.schemaType,
      fontHref: template.fontHref,
    })

    const canonical = grab(html, /<link rel="canonical" href="([^"]*)"/)
    const ogUrl = grab(html, /<meta property="og:url" content="([^"]*)"/)
    const jsonLd = grab(html, /"url":\s*"([^"]*)"/)

    assert.equal(canonical, 'https://campus-glow.myshop.co.ke', 'canonical must be the claimed domain')
    assert.equal(ogUrl, 'https://campus-glow.myshop.co.ke', 'og:url must be the claimed domain')
    assert.equal(jsonLd, 'https://campus-glow.myshop.co.ke', 'JSON-LD url must be the claimed domain')

    // The two bugs this replaced.
    assert.ok(!html.includes('https://https://'), 'must not emit a doubled scheme')
    assert.ok(!html.includes('myshop.co.ke.keel'), 'must not double-append the root')

    // The per-template fields must still reach the head, now that there is one
    // shared index.html rather than five near-identical copies.
    assert.ok(html.includes(template.titleSuffix), 'title must carry the template suffix')
    assert.ok(
      html.includes(`"@type": "${template.schemaType}"`),
      'schema @type must be the template type'
    )
  })
}

test('a font href is only emitted when the template asks for one', async () => {
  const withFont = await renderIndexHtml({
    domain: 'a.myshop.co.ke', fontHref: 'https://fonts.example/x.css', titleSuffix: '',
  })
  assert.ok(withFont.includes('https://fonts.example/x.css'))

  const without = await renderIndexHtml({ domain: 'a.myshop.co.ke', fontHref: '', titleSuffix: '' })
  assert.ok(!without.includes('fonts.example'))
})

test('the Keel-branded asset links stay pointed at the Keel app', async () => {
  const html = await renderIndexHtml({ domain: 'campus-glow.myshop.co.ke', titleSuffix: '' })
  // Shared favicons are served by the Keel dashboard, not the shop's domain.
  assert.ok(html.includes('https://keel.framestudio.co.ke/keel-icon.webp'))
  assert.ok(html.includes('https://keel.framestudio.co.ke/favicon-32x32.png'))
})

test('every catalogued design is a section list plus a theme - not a directory', () => {
  // The property that makes adding a design a five-line change. If a template ever
  // needs its own files again, this is where it should fail loudly.
  for (const t of listTemplates()) {
    assert.ok(Array.isArray(t.sections), `${t.id} must declare a sections array`)
    assert.equal(typeof t.theme, 'string', `${t.id} must name a theme`)
  }
  assert.ok(DESIGNS.length >= 5, 'the five catalogued designs should still be listed')
})
