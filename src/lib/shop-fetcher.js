import { supabase } from '../db.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function fetchShopData(shopId) {
  const isUuid = UUID_RE.test(shopId)
  const query = supabase.from('shops').select('*')
  const q = isUuid ? query.eq('id', shopId) : query.eq('slug', shopId)
  const shopRes = await q.maybeSingle()
  if (!shopRes.data) throw new Error(`Shop not found`)

  const [settingsRes, catalogueRes, bannersRes] = await Promise.all([
    supabase.from('store_settings').select('*').eq('shop_id', shopRes.data.id).maybeSingle(),
    supabase.from('catalogue').select('*').eq('shop_id', shopRes.data.id).order('created_at', { ascending: false }),
    supabase.from('banners').select('*').eq('shop_id', shopRes.data.id).order('sort_order', { ascending: true }),
  ])

  return {
    shop: shopRes.data,
    settings: settingsRes.data || {},
    catalogue: catalogueRes.data || [],
    banners: bannersRes.data || [],
  }
}
