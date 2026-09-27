import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { templatesRoutes } from './routes/templates.js'
import { buildRoutes } from './routes/build.js'
import { provisionRoutes } from './routes/provision.js'
import { statusRoutes } from './routes/status.js'
import { deleteRoutes } from './routes/delete.js'
import { webhookRoutes } from './routes/webhook.js'
import { startWorker } from './lib/jobs.js'

const app = new Hono()

const DEFAULT_ORIGINS = [
  'https://keel-nu.vercel.app',
  'https://keel.framestudio.co.ke',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_ORIGINS

app.use('/*', cors({
  origin: allowedOrigins,
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.get('/', (c) => c.json({ ok: true, name: 'storefront-provisioner' }))

app.route('/templates', templatesRoutes)
app.route('/build', buildRoutes)
app.route('/provision', provisionRoutes)
app.route('/status', statusRoutes)
app.route('/delete', deleteRoutes)
app.route('/webhooks', webhookRoutes)

if (!process.env.SUPABASE_JWT_SECRET) {
  console.error('WARNING: SUPABASE_JWT_SECRET is not set — protected routes will return 503')
}

const port = parseInt(process.env.PORT || '3002')

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`storefront-provisioner running on http://localhost:${info.port}`)
})

startWorker()
