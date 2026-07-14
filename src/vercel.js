const VERCEL_TOKEN = process.env.VERCEL_TOKEN
const API = 'https://api.vercel.com'

if (!VERCEL_TOKEN) {
  console.error('Missing VERCEL_TOKEN')
  process.exit(1)
}

async function vercelFetch(path, options = {}) {
  const url = `${API}${path}`
  console.log(`Vercel API: ${options.method || 'GET'} ${url}`)
  if (options.body) console.log(`Request body: ${options.body}`)
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const body = await res.json()
  if (!res.ok) {
    console.error(`Vercel API error ${res.status}:`, JSON.stringify(body))
    throw new Error(`Vercel API error ${res.status}: ${body.error?.message || JSON.stringify(body)}`)
  }
  return body
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
