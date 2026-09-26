// Zero-dependency tests: node --test
//
// Covers the one genuinely risky decision in the deploy job — whether we are
// allowed to overwrite a shop's store_settings.website_url. Getting that wrong
// either clobbers an address the owner set deliberately, or leaves the stale
// value that motivated doing this at all (one shop had website_url pointing at a
// completely different storefront).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDomain, validateSubdomain } from './domain.js'
import { isManagedWebsiteUrl } from './website-url.js'

test('formatDomain joins a label to the platform root', () => {
  assert.equal(formatDomain('my-shop'), 'my-shop.keel.framestudio.co.ke')
})

test('formatDomain sanitises the label the way validateSubdomain expects', () => {
  assert.equal(formatDomain('My Shop!'), 'my-shop.keel.framestudio.co.ke')
  assert.equal(formatDomain('--trim--'), 'trim.keel.framestudio.co.ke')
})

test('validateSubdomain rejects reserved names', () => {
  assert.ok(validateSubdomain('www'))
  assert.ok(validateSubdomain('admin'))
  assert.equal(validateSubdomain('my-shop'), null)
})

// --- website_url ownership -------------------------------------------------

test('an empty website_url is ours to write', () => {
  assert.equal(isManagedWebsiteUrl(''), true)
  assert.equal(isManagedWebsiteUrl(null), true)
  assert.equal(isManagedWebsiteUrl(undefined), true)
})

test('a Vercel fallback host is ours to replace', () => {
  assert.equal(isManagedWebsiteUrl('https://storefront-x.vercel.app/'), true)
  assert.equal(isManagedWebsiteUrl('https://shop-abc.vercel.app'), true)
})

test('an address under our platform root is ours to replace', () => {
  assert.equal(isManagedWebsiteUrl('https://shop.keel.framestudio.co.ke/'), true)
  assert.equal(isManagedWebsiteUrl('shop.keel.framestudio.co.ke'), true)
})

test('a domain the owner chose is NOT ours to touch', () => {
  // The case that matters: a client-owned custom domain must survive a redeploy.
  assert.equal(isManagedWebsiteUrl('https://theirshop.com/'), false)
  assert.equal(isManagedWebsiteUrl('https://www.theirshop.com/'), false)
  assert.equal(isManagedWebsiteUrl('https://shop.theirshop.com/'), false)
})

test('a lookalike of our root is not ours', () => {
  // Guard against a suffix match on a domain that merely ends in the same string.
  assert.equal(isManagedWebsiteUrl('https://evil-keel.framestudio.co.ke.attacker.com/'), false)
  assert.equal(isManagedWebsiteUrl('https://notkeel.framestudio.co.ke/'), false)
})

test('garbage is treated as not-ours so it is never overwritten blindly', () => {
  assert.equal(isManagedWebsiteUrl('::::not a url::::'), false)
})

test('an alternate platform root can be supplied', () => {
  const root = 'myshop.co.ke'
  assert.equal(isManagedWebsiteUrl('https://a.myshop.co.ke/', root), true)
  assert.equal(isManagedWebsiteUrl('https://a.keel.framestudio.co.ke/', root), false)
})
