import { Hono } from 'hono'
import { listTemplates } from '../templates/registry.js'

export const templatesRoutes = new Hono()

templatesRoutes.get('/', (c) => {
  return c.json({ templates: listTemplates() })
})
