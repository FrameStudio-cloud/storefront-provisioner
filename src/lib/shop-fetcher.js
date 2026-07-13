import { supabase } from '../db.js'

export async function fetchShopData(shopId) {
  const [shopRes, settingsRes, catalogueRes, bannersRes] = await Promise.all([
    supabase.from('shops').select('*').eq('id', shopId).single(),
    supabase.from('store_settings').select('*').eq('shop_id', shopId).maybeSingle(),
    supabase.from('catalogue').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
    supabase.from('banners').select('*').eq('shop_id', shopId).order('sort_order', { ascending: true }),
  ])

  if (shopRes.error) throw new Error(`Shop not found: ${shopRes.error.message}`)

  return {
    shop: shopRes.data,
    settings: settingsRes.data || {},
    catalogue: catalogueRes.data || [],
    banners: bannersRes.data || [],
  }
}
