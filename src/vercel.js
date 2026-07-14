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
  return { url: body.url, id: body.id, readyState: body.readyState }
}

export async function assignDomain(projectId, domain) {
  const body = await vercelFetch(`/v9/projects/${projectId}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: domain }),
  })
  return { domain: body.name, verified: body.verified }
}

export async function deleteProject(projectId) {
  await vercelFetch(`/v9/projects/${projectId}`, { method: 'DELETE' })
  return { deleted: true }
}
