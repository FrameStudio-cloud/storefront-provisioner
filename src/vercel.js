const VERCEL_TOKEN = process.env.VERCEL_TOKEN
const API = 'https://api.vercel.com'

if (!VERCEL_TOKEN) {
  console.error('Missing VERCEL_TOKEN')
  process.exit(1)
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function vercelFetch(path, options = {}) {
  const url = `${API}${path}`
  const maxRetries = options.method === 'GET' ? 3 : 2
  const timeout = 30_000

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      console.log(`Vercel API (attempt ${attempt}/${maxRetries}): ${options.method || 'GET'} ${url}`)
      if (options.body) console.log(`Request body: ${options.body}`)

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      clearTimeout(timer)

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10)
        console.warn(`Rate limited (attempt ${attempt}), waiting ${retryAfter}s...`)
        if (attempt < maxRetries) {
          await sleep(retryAfter * 1000)
          continue
        }
      }

      const body = await res.json()
      if (!res.ok) {
        console.error(`Vercel API error ${res.status}:`, JSON.stringify(body))
        throw new Error(`Vercel API error ${res.status}: ${body.error?.message || JSON.stringify(body)}`)
      }
      return body
    } catch (err) {
      clearTimeout(timer)
      if (err.name === 'AbortError') {
        console.warn(`Vercel API timeout (attempt ${attempt}/${maxRetries})`)
        if (attempt < maxRetries) {
          await sleep(1000 * attempt)
          continue
        }
        throw new Error(`Vercel API timeout after ${maxRetries} attempts: ${url}`)
      }
      if (attempt < maxRetries) {
        console.warn(`Vercel API error (attempt ${attempt}/${maxRetries}):`, err.message)
        await sleep(1000 * attempt)
        continue
      }
      throw err
    }
  }
}

async function waitForDeployment(deploymentId, maxWait = 120_000) {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    await sleep(3000)
    const body = await vercelFetch(`/v13/deployments/${deploymentId}`)
    if (body.readyState === 'READY') return body
    if (body.readyState === 'ERROR') {
      throw new Error(`Deployment failed: ${body.error?.message || 'Build error — check Vercel dashboard'}`)
    }
    console.log(`Deployment ${deploymentId} state: ${body.readyState} (${Math.round((Date.now() - start) / 1000)}s)`)
  }
  throw new Error(`Deployment did not become READY within ${maxWait / 1000}s`)
}

export async function createProject(name) {
  const body = await vercelFetch('/v9/projects', {
    method: 'POST',
    body: JSON.stringify({ name, framework: 'vite' }),
  })
  return { id: body.id, name: body.name }
}

export async function createDeployment(projectName, projectId, files, envVars = {}) {
  const body = await vercelFetch(`/v13/deployments`, {
    method: 'POST',
    body: JSON.stringify({
      name: projectName,
      project: projectId,
      target: 'production',
      files,
      projectSettings: { framework: 'vite' },
      env: envVars,
    }),
  })
  console.log(`Deployment created: url=${body.url} id=${body.id} state=${body.readyState} alias=${JSON.stringify(body.alias)}`)

  if (body.readyState !== 'READY') {
    const ready = await waitForDeployment(body.id)
    return {
      url: ready.alias?.[0] || ready.url,
      id: ready.id,
      readyState: ready.readyState,
    }
  }

  return {
    url: body.alias?.[0] || body.url,
    id: body.id,
    readyState: body.readyState,
  }
}

export async function assignDomain(projectId, domain) {
  const body = await vercelFetch(`/v9/projects/${projectId}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: domain }),
  })
  return { domain: body.name, verified: !!body.verified }
}

// Read the current state of a domain on a project. Returns { found: false } when
// Vercel does not know about it, rather than throwing — callers need to tell
// "already assigned to this project" (benign on redeploy) apart from "refused"
// (a real failure), and only the latter should be surfaced.
export async function getDomain(projectId, domain) {
  try {
    const body = await vercelFetch(
      `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`
    )
    return {
      found: true,
      domain: body.name,
      verified: !!body.verified,
      verification: body.verification || [],
    }
  } catch (err) {
    if (/Vercel API error 404/.test(err.message)) return { found: false, verified: false }
    throw err
  }
}

// Vercel issues the TLS cert asynchronously, so `verified` is usually false on the
// response to the assign call even when it will succeed moments later. Poll until
// it flips. Runs inside the long-lived deploy worker (not a request), so blocking
// here is safe — waitForDeployment already blocks for up to 120s.
export async function waitForDomainVerification(projectId, domain, options = {}) {
  const timeoutMs = options.timeoutMs ?? 90_000
  const intervalMs = options.intervalMs ?? 3_000
  const start = Date.now()
  let last = { found: false, verified: false }

  while (Date.now() - start < timeoutMs) {
    last = await getDomain(projectId, domain)
    if (last.verified) return { ...last, timedOut: false }
    // Assigned but Vercel will never verify it (e.g. DNS does not cover this
    // name). Each check re-reads verification records, so bail early rather than
    // burning the full timeout.
    const reason = (last.verification || []).map((v) => v.reason).filter(Boolean)
    if (reason.length > 0 && reason.every((r) => r === 'unconfigured' || r === 'mismatch')) {
      // keep polling: Vercel can still resolve this once DNS propagates
      if (Date.now() - start > intervalMs * 2) {
        return { ...last, timedOut: true, reasons: reason }
      }
    }
    await sleep(intervalMs)
  }

  return { ...last, timedOut: true }
}

export async function deleteProject(projectId) {
  await vercelFetch(`/v9/projects/${projectId}`, { method: 'DELETE' })
  return { deleted: true }
}

// Register a project webhook so Vercel can push deployment lifecycle events back
// to us. Non-fatal: if unconfigured or it fails, the worker's polling fallback
// still completes the job.
export async function registerProjectWebhook(projectId) {
  const url = process.env.VERCEL_WEBHOOK_URL
  const secret = process.env.VERCEL_WEBHOOK_SECRET
  if (!url || !secret) {
    console.warn('VERCEL_WEBHOOK_URL/SECRET not set — skipping project webhook registration')
    return null
  }
  try {
    const body = await vercelFetch(`/v1/projects/${projectId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify({
        events: ['deployment.created', 'deployment.ready', 'deployment.error', 'deployment.canceled'],
        url,
        secret,
      }),
    })
    console.log(`Registered project webhook for ${projectId}`)
    return body
  } catch (err) {
    console.warn('Failed to register project webhook (continuing):', err.message)
    return null
  }
}
