import { Hono } from 'hono'
import { supabase } from '../db.js'
import { deleteProject } from '../vercel.js'

export const deleteRoutes = new Hono()

deleteRoutes.delete('/:shopId', async (c) => {
  const shopId = c.req.param('shopId')

  const { data, error } = await supabase
    .from('storefront_deployments')
    .select('*')
    .eq('shop_id', shopId)
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'No deployment found for this shop' }, 404)

  if (data.vercel_project_id) {
    await deleteProject(data.vercel_project_id)
  }

  await supabase.from('storefront_deployments').delete().eq('shop_id', shopId)

  return c.json({ deleted: true })
})
