import { Hono } from 'hono'
import crypto from 'crypto'
import { updateJob, addEvent, getJobByVercelRef } from '../lib/deploy.js'

export const webhookRoutes = new Hono()

// Vercel project webhook → deployment lifecycle events.
// Driven by Vercel (server-to-server), so no shop JWT required here.
webhookRoutes.post('/vercel', async (c) => {
  const secret = process.env.VERCEL_WEBHOOK_SECRET
  if (!secret) return c.json({ error: 'Webhook not configured' }, 503)

  const raw = await c.req.text()
  const signature = c.req.header('x-vercel-signature') || ''
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  if (signature !== expected) return c.json({ error: 'Invalid signature' }, 401)

  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const type = body.type || ''
  const deployment = body.payload?.deployment || {}
  const { id: deploymentId, projectId, readyState, url } = deployment
  if (!projectId && !deploymentId) return c.json({ ok: true, ignored: true })

  const job = await getJobByVercelRef({ projectId, deploymentId })
  if (!job) return c.json({ ok: true, ignored: true })

  if (type === 'deployment.ready') {
    await updateJob(job.id, { status: 'domain', vercel_deployment_id: deploymentId })
    await addEvent({ job_id: job.id, shop_id: job.shop_id, event: 'deploy', status: 'done', detail: { url } })
    await addEvent({ job_id: job.id, shop_id: job.shop_id, event: 'domain', status: 'current' })
  } else if (type === 'deployment.error' || type === 'deployment.canceled') {
    const message = readyState === 'ERROR'
      ? 'Build error — check the Vercel dashboard for details'
      : 'Deployment canceled'
    await updateJob(job.id, {
      status: 'failed',
      error: message,
      completed_at: new Date().toISOString(),
    })
    await addEvent({ job_id: job.id, shop_id: job.shop_id, event: 'error', status: 'error', detail: { type } })
  }

  return c.json({ ok: true })
})
