import { Hono } from 'hono'
import { supabase } from '../db.js'

export const statusRoutes = new Hono()

statusRoutes.get('/', async (c) => {
  const shopId = c.req.query('shop_id')
  if (!shopId) return c.json({ error: 'shop_id is required' }, 400)

  const { data, error } = await supabase
    .from('storefront_deployments')
    .select('*')
    .eq('shop_id', shopId)
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ deployed: false }, 200)

  return c.json({ deployed: true, ...data })
})
