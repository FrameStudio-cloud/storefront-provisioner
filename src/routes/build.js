import { Hono } from 'hono'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Identifies WHICH build is actually serving.
//
// This exists because deploys were unverifiable from outside: Render posts no
// GitHub status for this repo, X-Render-Origin-Server is the constant string
// "Render" on every deploy, and nothing in the public routes' responses changes
// when the code does. The same absence let a vendored copy of this service drift
// from the repo Render actually builds, unnoticed. So: ask the running process.
//
// Deliberately not exposed beyond a short SHA, the branch, uptime, and two
// booleans. No file paths, no environment values, no credentials.

const SRC_DIR = join(fileURLToPath(import.meta.url), '..', '..')
const STARTED_AT = new Date().toISOString()
const SCHEMA_CACHE_MS = 60_000
// supabase-js retries a failed request, and a probe against an unreachable
// database was measured taking ~15s to give up. A diagnostic endpoint that hangs
// for a quarter of a minute is worse than one that answers "unknown" promptly, so
// the whole probe is bounded.
const SCHEMA_PROBE_TIMEOUT_MS = 3000

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

// A fingerprint of the source that is actually running. More useful than the
// commit when the vendored copy and the deploy repo disagree, and it needs no
// git, no build step and no env var. The .env file is excluded on principle.
function fingerprintSource() {
  const hash = createHash('sha256')
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name === '.git' || name === '.env' || name === '.env.example') continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else {
        hash.update(relative(SRC_DIR, full).split(sep).join('/'))
        hash.update(readFileSync(full))
      }
    }
  }
  walk(SRC_DIR)
  return hash.digest('hex').slice(0, 12)
}

let _codeSha = null
function codeSha() {
  if (_codeSha) return _codeSha
  try {
    _codeSha = fingerprintSource()
  } catch {
    _codeSha = null
  }
  return _codeSha
}

// Render injects RENDER_GIT_COMMIT at build time; the build command is a
// `git clone`, so `git rev-parse` usually works too. Either may be absent, and
// that is fine — codeSha still identifies the build.
function gitInfo() {
  const out = { commit: null, branch: null }
  if (process.env.RENDER_GIT_COMMIT) {
    out.commit = process.env.RENDER_GIT_COMMIT.slice(0, 40)
    out.branch = process.env.RENDER_GIT_BRANCH || null
    return out
  }
  try {
    out.commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: SRC_DIR,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
    out.branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: SRC_DIR,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  } catch {
    // No git in the container. Not an error.
  }
  return out
}

let _schemaCache = { at: 0, value: null }

// db.js calls process.exit(1) when the Supabase credentials are absent, so it is
// imported lazily rather than at module scope. Otherwise merely importing this
// file to unit-test the fingerprint would kill the process — which is how the
// local `npm test` run died the first time.
let _clientPromise = null
async function defaultClient() {
  if (!_clientPromise) _clientPromise = import('../db.js').then((m) => m.supabase)
  return _clientPromise
}

// Probes the database rather than asserting what the code believes. Answers the
// question that actually matters during a deploy: is the running build's expected
// schema present, or did someone merge code ahead of its migration?
//
// The client is injectable so both branches are testable without credentials —
// placeholder keys in .env make every probe error, which correctly yields
// false/false instead of a 500.
export async function schemaState(client, { force = false, timeoutMs = SCHEMA_PROBE_TIMEOUT_MS } = {}) {
  if (!force && _schemaCache.value && Date.now() - _schemaCache.at < SCHEMA_CACHE_MS) {
    return _schemaCache.value
  }
  const value = { platformDomains: false, domainStateColumns: false }
  try {
    const db = client || (await withTimeout(defaultClient(), timeoutMs, null))
    if (!db) throw new Error('database client unavailable')
    // PostgREST reports an unknown relation/column as a PostgREST error rather
    // than throwing, so probe for the error rather than for a thrown exception.
    const unreachable = { data: null, error: { message: 'probe timed out' } }
    // Concurrent, so the worst case is one timeout rather than two in series.
    const [domains, state] = await Promise.all([
      withTimeout(db.from('platform_domains').select('domain').limit(1), timeoutMs, unreachable),
      withTimeout(
        db.from('storefront_deployments').select('domain_verified, domain_status').limit(1),
        timeoutMs,
        unreachable
      ),
    ])
    value.platformDomains = !domains.error
    value.domainStateColumns = !state.error
  } catch {
    // Leave both false: "unknown" is the honest answer when we cannot tell.
  }
  _schemaCache = { at: Date.now(), value }
  return value
}

// Test seam: clear the memo so each test starts from a cold cache.
export function resetSchemaCache() {
  _schemaCache = { at: 0, value: null }
}

export const buildRoutes = new Hono()

buildRoutes.get('/', async (c) => {
  const git = gitInfo()
  return c.json({
    ok: true,
    service: 'storefront-provisioner',
    build: {
      codeSha: codeSha(),
      gitCommit: git.commit,
      gitBranch: git.branch,
      startedAt: STARTED_AT,
      uptimeSeconds: Math.round(process.uptime()),
      schema: await schemaState(),
    },
  })
})

export { codeSha }
