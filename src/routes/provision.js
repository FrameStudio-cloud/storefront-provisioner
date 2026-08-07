import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { supabase } from '../db.js'
import { validateSubdomain } from '../lib/domain.js'
import { getTemplate } from '../templates/registry.js'
import { requireShop } from '../lib/auth.js'
import { rateLimit } from '../lib/rate-limit.js'
import { deploySchema } from '../lib/schema.js'
import { createJob, addEvent, getActiveJob } from '../lib/deploy.js'
import { sendDeployJob } from '../lib/jobs.js'

export const provisionRoutes = new Hono()

provisionRoutes.use(requireShop())
provisionRoutes.use(rateLimit({
  keyFn: (c) => `deploy:${c.get('shopId')}`,
  windowMs: parseInt(process.env.DEPLOY_RATE_LIMIT_WINDOW_MS || '3600000', 10),
  limit: parseInt(process.env.DEPLOY_RATE_LIMIT || '3', 10),
  errorMessage: 'Deploy rate limit exceeded. Try again later.',
}))

// Enqueue a storefront deployment. Heavy lifting (render, Vercel, domain) is done
// asynchronously by the deploy worker so HTTP requests stay fast and retryable.
provisionRoutes.post('/', async (c) => {
  try {
    let body
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = deploySchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request payload', details: parsed.error.flatten() }, 400)
    }
    const { shop_id, template_id, subdomain, sections, config } = parsed.data

    if (shop_id !== c.get('shopId')) {
      return c.json({ error: 'shop_id does not match the authenticated account' }, 403)
    }

    const domainError = validateSubdomain(subdomain)
    if (domainError) return c.json({ error: domainError }, 400)

    const template = getTemplate(template_id || 'classic')
    if (!template) return c.json({ error: 'Invalid template_id' }, 400)

    // Fail-fast checks that don't require hitting Vercel
    const existing = await supabase
      .from('storefront_deployments')
      .select('*')
      .eq('shop_id', shop_id)
      .maybeSingle()

    if (existing.data && existing.data.subdomain !== subdomain.toLowerCase()) {
      return c.json({ error: 'Shop already has a storefront with a different subdomain. Delete it first.' }, 409)
    }

    const taken = await supabase
      .from('storefront_deployments')
      .select('id')
      .eq('subdomain', subdomain.toLowerCase())
      .neq('shop_id', shop_id)
      .maybeSingle()

    if (taken.data) {
      return c.json({ error: 'Subdomain already taken' }, 409)
    }

    // Idempotency: if this shop already has an in-flight job, reuse it instead
    // of starting a second concurrent deploy.
    const active = await getActiveJob(shop_id)
    if (active) {
      return c.json({
        job_id: active.id,
        trace_id: active.trace_id,
        status: active.status,
        in_progress: true,
      }, 409)
    }

    const traceId = randomUUID()
    const job = await createJob({
      shop_id,
      template_id: template.id,
      subdomain: subdomain.toLowerCase(),
      sections,
      config,
      trace_id: traceId,
    })
    await addEvent({ job_id: job.id, shop_id, event: 'render', status: 'queued' })
    await sendDeployJob({ job_id: job.id })

    return c.json({
      job_id: job.id,
      trace_id: traceId,
      status: 'queued',
      queued: true,
    }, 202)
  } catch (err) {
    console.error('Provision enqueue error:', err)
    return c.json({ error: err.message }, 500)
  }
})
