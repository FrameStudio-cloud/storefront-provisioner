import { Hono } from 'hono'
import { supabase } from '../db.js'
import { fetchShopData } from '../lib/shop-fetcher.js'
import { renderTemplate } from '../lib/renderer.js'
import { createProject, createDeployment, assignDomain, deleteProject } from '../vercel.js'
import { formatDomain, validateSubdomain } from '../lib/domain.js'
import { getTemplate } from '../templates/registry.js'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const TEMPLATES_DIR = join(__dirname, '..', 'templates')

export const provisionRoutes = new Hono()

provisionRoutes.post('/', async (c) => {
  try {
    const { shop_id, template_id, subdomain } = await c.req.json()

    if (!shop_id) return c.json({ error: 'shop_id is required' }, 400)
    if (!subdomain) return c.json({ error: 'subdomain is required' }, 400)

    const domainError = validateSubdomain(subdomain)
    if (domainError) return c.json({ error: domainError }, 400)

    const template = getTemplate(template_id || 'classic')
    if (!template) return c.json({ error: 'Invalid template_id' }, 400)

    const existing = await supabase
      .from('storefront_deployments')
      .select('*')
      .eq('shop_id', shop_id)
      .maybeSingle()

    if (existing.data && existing.data.subdomain !== subdomain.toLowerCase()) {
      return c.json({ error: 'Shop already has a storefront with a different subdomain. Delete it first.' }, 409)
    }

    const taken = await supabase
      .from('storefront_deployments')
      .select('id')
      .eq('subdomain', subdomain.toLowerCase())
      .neq('shop_id', shop_id)
      .maybeSingle()

    if (taken.data) {
      return c.json({ error: 'Subdomain already taken' }, 409)
    }

    const rawData = await fetchShopData(shop_id)

    const templateDir = join(TEMPLATES_DIR, template.id)
    if (!existsSync(templateDir)) {
      return c.json({ error: `Template directory not found: ${template.id}` }, 500)
    }

    const renderedFiles = renderTemplate(templateDir, rawData)

    const vercelFiles = Object.entries(renderedFiles).map(([path, data]) => ({
      file: path.replace(/\\/g, '/'),
      data: Buffer.from(data).toString('base64'),
      encoding: 'base64',
    }))

    const domain = formatDomain(subdomain)

    if (!process.env.SUPABASE_ANON_KEY) {
      throw new Error('SUPABASE_ANON_KEY is required — refusing to deploy with service role key in client bundle')
    }
    const envVars = {
      VITE_SUPABASE_URL: process.env.SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      VITE_SHOP_SLUG: rawData.shop.slug,
    }

    let deployment
    let projectId

    if (existing.data) {
      projectId = existing.data.vercel_project_id
      deployment = await createDeployment(subdomain.toLowerCase(), projectId, vercelFiles, envVars)
    } else {
      const projectName = `storefront-${subdomain.toLowerCase()}`
      const project = await createProject(projectName)
      projectId = project.id
      try {
        deployment = await createDeployment(projectName, projectId, vercelFiles, envVars)
      } catch (err) {
        console.error('Deployment failed, cleaning up project:', projectId)
        try { await deleteProject(projectId) } catch (_) {}
        throw err
      }
    }

    let domainResult = null
    try {
      domainResult = await assignDomain(projectId, domain)
    } catch (err) {
      console.warn('Domain assignment failed (will be retried):', err.message)
    }

    console.log(`Deployment response:`, JSON.stringify(deployment))

    if (existing.data) {
      const { error: updateError } = await supabase
        .from('storefront_deployments')
        .update({
          template_id: template.id,
          url: `https://${deployment.url}`,
          domain: domainResult?.domain || domain,
          status: 'deployed',
        })
        .eq('shop_id', shop_id)

      if (updateError) {
        console.error('Failed to update deployment record:', updateError.message)
      }
    } else {
      const { error: insertError } = await supabase.from('storefront_deployments').insert({
        shop_id: rawData.shop.id,
        template_id: template.id,
        subdomain: subdomain.toLowerCase(),
        vercel_project_id: projectId,
        url: `https://${deployment.url}`,
        domain: domainResult?.domain || domain,
        status: 'deployed',
      })

      if (insertError) {
        console.error('Failed to save deployment record:', insertError.message)
      }
    }

    return c.json({
      success: true,
      url: `https://${deployment.url}`,
      domain: domainResult?.domain || domain,
      project_id: projectId,
    }, existing.data ? 200 : 201)

  } catch (err) {
    console.error('Provision error:', err)
    return c.json({ error: err.message }, 500)
  }
})
