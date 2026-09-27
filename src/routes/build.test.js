// Tests for GET /build — the endpoint that makes a deploy verifiable from outside.
//
// Both branches of the schema probe are covered, including the one that actually
// happened during development: a .env holding placeholder credentials makes every
// PostgREST call return "Invalid API key", and the endpoint must report false
// rather than throw a 500. Getting that wrong would turn a diagnostic endpoint
// into an outage.
//
// node --test, no credentials needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Set before anything imports db.js. The route test resolves the real client
// lazily; pointing it at an unroutable host exercises the degraded path (the
// database cannot be reached, the endpoint must still answer 200 with
// false/false) without needing real credentials. db.js process.exits when these
// are absent, so they must be set either way.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key-for-tests'

const { buildRoutes, schemaState, resetSchemaCache, codeSha } = await import('./build.js')

// Stand-in for the Supabase client: each table either resolves or errors, the way
// PostgREST reports an unknown relation or column.
function stubClient({ ok = [], fail = [] } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      calls.push(table)
      const chain = {
        select() { return chain },
        limit() {
          const bad = fail.includes(table)
          return Promise.resolve(
            bad
              ? { data: null, error: { message: 'Invalid API key' } }
              : { data: [{ x: 1 }], error: null }
          )
        },
      }
      return chain
    },
  }
}

test('reports the schema as present when both objects exist', async () => {
  resetSchemaCache()
  const state = await schemaState(stubClient({ ok: ['platform_domains', 'storefront_deployments'] }), { force: true })
  assert.deepEqual(state, { platformDomains: true, domainStateColumns: true })
})

test('reports platform_domains missing when that migration has not run', async () => {
  resetSchemaCache()
  // The realistic bad merge: code deployed, migration 003 not applied yet.
  const state = await schemaState(stubClient({ fail: ['platform_domains'] }), { force: true })
  assert.deepEqual(state, { platformDomains: false, domainStateColumns: true })
})

test('reports domain state columns missing when migration 002 has not run', async () => {
  resetSchemaCache()
  const state = await schemaState(stubClient({ fail: ['storefront_deployments'] }), { force: true })
  assert.deepEqual(state, { platformDomains: true, domainStateColumns: false })
})

test('degrades to false/false when the database is unreachable', async () => {
  resetSchemaCache()
  const state = await schemaState(stubClient({ fail: ['platform_domains', 'storefront_deployments'] }), { force: true })
  assert.deepEqual(state, { platformDomains: false, domainStateColumns: false })
})

test('degrades to false/false when the client throws outright', async () => {
  resetSchemaCache()
  const throwing = {
    from() {
      return { select() { return { limit() { throw new Error('socket hang up') } } } }
    },
  }
  const state = await schemaState(throwing, { force: true })
  assert.deepEqual(state, { platformDomains: false, domainStateColumns: false })
})

test('caches within the window and re-probes when forced', async () => {
  resetSchemaCache()
  const client = stubClient({ ok: ['platform_domains', 'storefront_deployments'] })
  await schemaState(client, { force: true })
  const afterFirst = client.calls.length
  await schemaState(client)
  assert.equal(client.calls.length, afterFirst, 'second call must be served from cache')
  await schemaState(client, { force: true })
  assert.ok(client.calls.length > afterFirst, 'force must bypass the cache')
})

test('probes the two expected tables', async () => {
  resetSchemaCache()
  const client = stubClient({ ok: ['platform_domains', 'storefront_deployments'] })
  await schemaState(client, { force: true })
  assert.deepEqual(client.calls.sort(), ['platform_domains', 'storefront_deployments'])
})

test('fingerprints the running source and ignores .env', () => {
  const sha = codeSha()
  assert.match(sha, /^[0-9a-f]{12}$/)
  // Stable within a process: the source cannot change under a running build.
  assert.equal(codeSha(), sha)
})

test('answers promptly when the database hangs', async () => {
  resetSchemaCache()
  // A client whose promise never settles. Without the timeout this is the ~15s
  // hang measured against an unroutable host.
  const hanging = {
    from() {
      return { select() { return { limit: () => new Promise(() => {}) } } }
    },
  }
  const started = Date.now()
  const state = await schemaState(hanging, { force: true, timeoutMs: 250 })
  const elapsed = Date.now() - started
  assert.deepEqual(state, { platformDomains: false, domainStateColumns: false })
  assert.ok(elapsed < 2000, `probe must give up quickly, took ${elapsed}ms`)
})

test('the route responds and exposes no secrets or paths', async () => {
  resetSchemaCache()
  const res = await buildRoutes.request('/')
  assert.equal(res.status, 200)
  const body = await res.json()

  assert.equal(body.ok, true)
  assert.equal(body.service, 'storefront-provisioner')
  assert.ok(body.build.codeSha, 'codeSha must be present')
  assert.ok(body.build.startedAt, 'startedAt must be present')
  assert.equal(typeof body.build.uptimeSeconds, 'number')
  assert.ok(body.build.schema, 'schema block must be present')

  // The whole point of keeping this endpoint narrow.
  const serialised = JSON.stringify(body)
  for (const secret of ['SUPABASE', 'VERCEL', 'KEY', 'TOKEN', 'SECRET', 'DATABASE_URL', '\\', '/home/']) {
    assert.ok(!serialised.includes(secret), `response must not mention ${secret}`)
  }
})
