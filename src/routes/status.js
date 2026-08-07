import { Hono } from 'hono'
import { supabase } from '../db.js'
import { requireShop } from '../lib/auth.js'
import { getLatestJob, getJobWithEvents } from '../lib/deploy.js'

export const statusRoutes = new Hono()

statusRoutes.use(requireShop())

statusRoutes.get('/', async (c) => {
  const shopId = c.req.query('shop_id')
  if (!shopId) return c.json({ error: 'shop_id is required' }, 400)
  if (shopId !== c.get('shopId')) return c.json({ error: 'Forbidden' }, 403)

  const { data, error } = await supabase
    .from('storefront_deployments')
    .select('*')
    .eq('shop_id', shopId)
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 500)

  const latest = await getLatestJob(shopId)
  let job = null
  if (latest) job = await getJobWithEvents(latest.id)

  if (!data) return c.json({ deployed: false, job })

  return c.json({ deployed: true, ...data, job })
})
