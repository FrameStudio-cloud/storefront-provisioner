// Renders the real template directories and inspects the emitted head tags.
//
// The point is the URL tags, not the styling: the templates used to derive their
// own canonical host by slugifying the shop name and appending a hardcoded
// platform root, then prefix the result with "https://" — while
// store_settings.website_url is stored WITH a scheme. That combination emitted
//   <link rel="canonical" href="https://https://shop.example/">
// which is a broken canonical on every storefront. Also confirms the root is no
// longer baked into the templates, so a second owned domain just works.
//
// node --test, no credentials needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostOf, resolveSiteHost } from './renderer.js'
import { formatDomain, FALLBACK_ROOT_DOMAIN } from './domain.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES = join(HERE, '..', 'templates')

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

// renderer.js is ESM and pulls in ejs plus the filesystem. Imported lazily so the
// pure-function tests above do not depend on module load order.
let _renderer
async function renderer() {
  if (!_renderer) _renderer = await import('./renderer.js')
  return _renderer
}

const grab = (html, re) => (html.match(re) || [])[1] || null

// renderTemplate returns a map of output path -> contents, and nested keys keep
// Windows separators, so find the html by suffix rather than hardcoding.
function renderIndexHtml(renderTemplate, templateId, configOverride) {
  const out = renderTemplate(join(TEMPLATES, templateId), SHOP, null, configOverride)
  const key = Object.keys(out).find((k) => k.replace(/\\/g, '/').endsWith('index.html'))
  assert.ok(key, `${templateId} produced no index.html (keys: ${Object.keys(out).join(', ')})`)
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

for (const templateId of ['classic', 'classic-heroui', 'bold', 'minimal', 'modern', 'clothing']) {
  test(`${templateId}: canonical, og:url and JSON-LD carry the claimed domain once`, async () => {
    const { renderTemplate } = await renderer()
    const html = renderIndexHtml(renderTemplate, templateId, {
      rootDomain: 'myshop.co.ke',
      domain: 'campus-glow.myshop.co.ke',
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
  })
}

test('the Keel-branded asset links stay pointed at the Keel app', async () => {
  const { renderTemplate } = await renderer()
  const html = renderIndexHtml(renderTemplate, 'classic', {
    rootDomain: 'myshop.co.ke',
    domain: 'campus-glow.myshop.co.ke',
  })
  // Shared favicons are served by the Keel dashboard, not the shop's domain.
  assert.ok(html.includes('https://keel.framestudio.co.ke/keel-icon.webp'))
  assert.ok(html.includes('https://keel.framestudio.co.ke/favicon-32x32.png'))
})
