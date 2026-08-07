import { jwtVerify } from 'jose'
import { supabase } from '../db.js'

async function verifySupabaseJwt(token) {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) {
    const err = new Error('SUPABASE_JWT_SECRET is not configured')
    err.config = true
    throw err
  }
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'],
  })
  return payload
}

async function resolveShopId(payload) {
  const uid = payload?.sub
  if (!uid) return null
  const { data } = await supabase
    .from('users')
    .select('shop_id')
    .eq('auth_user_id', uid)
    .maybeSingle()
  return data?.shop_id || null
}

// Requires a valid Supabase session JWT (HS256) and resolves the caller's shop_id.
// Sets c.get('uid') and c.get('shopId') for downstream handlers.
export function requireShop() {
  return async (c, next) => {
    if (!process.env.SUPABASE_JWT_SECRET) {
      console.error('SUPABASE_JWT_SECRET is not configured')
      return c.json({ error: 'Provisioner auth is not configured' }, 503)
    }

    const auth = c.req.header('Authorization') || ''
    const token = auth.replace(/^Bearer\s+/i, '').trim()
    if (!token) return c.json({ error: 'Missing Authorization header' }, 401)

    let payload
    try {
      payload = await verifySupabaseJwt(token)
    } catch (err) {
      console.warn('JWT verification failed:', err.message)
      return c.json({ error: 'Not authenticated' }, 401)
    }

    const shopId = await resolveShopId(payload)
    if (!shopId) return c.json({ error: 'No shop linked to this account' }, 403)

    c.set('uid', payload.sub)
    c.set('shopId', shopId)
    await next()
  }
}
