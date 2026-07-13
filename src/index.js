import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { templatesRoutes } from './routes/templates.js'
import { provisionRoutes } from './routes/provision.js'
import { statusRoutes } from './routes/status.js'
import { deleteRoutes } from './routes/delete.js'

const app = new Hono()

app.use('/*', cors())

app.get('/', (c) => c.json({ ok: true, name: 'storefront-provisioner' }))

app.route('/templates', templatesRoutes)
app.route('/provision', provisionRoutes)
app.route('/status', statusRoutes)
app.route('/delete', deleteRoutes)

const port = parseInt(process.env.PORT || '3002')

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`storefront-provisioner running on http://localhost:${info.port}`)
})
