import { Hono } from 'hono'
import { listTemplates, listAliases, MANIFEST_VERSION } from '../templates/registry.js'

export const templatesRoutes = new Hono()

templatesRoutes.get('/', (c) => {
  return c.json({
    version: MANIFEST_VERSION,
    templates: listTemplates(),
    aliases: listAliases(),
  })
})
