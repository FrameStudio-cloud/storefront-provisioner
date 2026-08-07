import { supabase } from '../db.js'
import { fetchShopData } from './shop-fetcher.js'
import { renderTemplate, renderFromSections } from './renderer.js'
import { createProject, createDeployment, assignDomain, deleteProject, registerProjectWebhook } from '../vercel.js'
import { formatDomain } from './domain.js'
import { getTemplate, getTemplateDir } from '../templates/registry.js'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const TEMPLATES_DIR = join(__dirname, '..', 'templates')

// Build a blueprint from an array of section IDs.
// Sections on both pages: navbar/*, footer/*, announcements, whatsapp-float, back-to-top
// Product-only: catalogue/product-detail, catalogue/related
// Everything else goes on home page only
function buildBlueprint(sectionIds) {
  const productOnly = ['catalogue/product-detail', 'catalogue/related']
  const bothPages = ['announcements', 'whatsapp-float', 'back-to-top']

  const home = sectionIds.filter(id => !productOnly.includes(id))

  const product = sectionIds.filter(id =>
    productOnly.includes(id) ||
    bothPages.includes(id) ||
    id.startsWith('navbar/') ||
    id.startsWith('footer/')
  )

  return { home, product }
}

export async function runDeployJob(job) {
  const { id: jobId, shop_id: shopId, template_id, subdomain, sections, config, trace_id } = job

  const update = (patch) => updateJob(jobId, patch)
  const event = (name, status, detail) => addEvent({ job_id: jobId, shop_id: shopId, event: name, status, detail })

  try {
    await update({ status: 'rendering', started_at: new Date().toISOString() })
    await event('render', 'current')

    const template = getTemplate(template_id || 'classic')
    if (!template) throw new Error('Invalid template_id')

    const rawData = await fetchShopData(shopId)

    // For custom/section-based templates, use the classic template dir as base
    const baseTemplateId = (sections && sections.length > 0) ? 'classic' : template.id

    const toolchain = config?.toolchain?.ui || null
    const variantDir = getTemplateDir(baseTemplateId, toolchain)
    let templateDir = join(TEMPLATES_DIR, variantDir)
    if (!existsSync(templateDir)) {
      console.warn(`[${trace_id || jobId}] Template variant "${variantDir}" not found, falling back to "${baseTemplateId}"`)
      templateDir = join(TEMPLATES_DIR, baseTemplateId)
    }

    let baseDir = null
    if (template.base) {
      const basePath = join(TEMPLATES_DIR, template.base)
      if (existsSync(basePath)) baseDir = basePath
    }

    let renderedFiles
    if (sections && sections.length > 0) {
      const sectionsCwd = join(process.cwd(), 'storefront-sections', 'sections')
      const sectionsLegacy = join(TEMPLATES_DIR, '..', '..', 'storefront-sections', 'sections')
      const sectionsDir = process.env.SECTIONS_DIR
        || (existsSync(sectionsCwd) ? sectionsCwd : sectionsLegacy)
      const blueprint = buildBlueprint(sections)
      renderedFiles = renderFromSections(templateDir, sectionsDir, rawData, blueprint, baseDir, config)
    } else {
      renderedFiles = renderTemplate(templateDir, rawData, baseDir, config)
    }

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

    await event('render', 'done')
    await update({ status: 'deploying' })
    await event('deploy', 'current')

    const existing = await supabase
      .from('storefront_deployments')
      .select('*')
      .eq('shop_id', shopId)
      .maybeSingle()

    if (existing.data && existing.data.subdomain !== subdomain.toLowerCase()) {
      throw new Error('Shop already has a storefront with a different subdomain. Delete it first.')
    }

    const taken = await supabase
      .from('storefront_deployments')
      .select('id')
      .eq('subdomain', subdomain.toLowerCase())
      .neq('shop_id', shopId)
      .maybeSingle()
    if (taken.data) throw new Error('Subdomain already taken')

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
        await registerProjectWebhook(projectId)
        deployment = await createDeployment(projectName, projectId, vercelFiles, envVars)
      } catch (err) {
        console.error(`[${trace_id || jobId}] Deployment failed, cleaning up project:`, projectId)
        try { await deleteProject(projectId) } catch (_) {}
        throw err
      }
    }

    await update({ vercel_project_id: projectId, vercel_deployment_id: deployment.id })

    await event('deploy', 'done')
    await update({ status: 'domain' })
    await event('domain', 'current')

    let domainResult = null
    try {
      domainResult = await assignDomain(projectId, domain)
    } catch (err) {
      console.warn(`[${trace_id || jobId}] Domain assignment failed (will be retried):`, err.message)
    }

    if (existing.data) {
      const { error: updateError } = await supabase
        .from('storefront_deployments')
        .update({
          template_id: template.id,
          url: `https://${deployment.url}`,
          domain: domainResult?.domain || domain,
          status: 'deployed',
        })
        .eq('shop_id', shopId)
      if (updateError) console.error(`[${trace_id || jobId}] Failed to update deployment record:`, updateError.message)
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
      if (insertError) console.error(`[${trace_id || jobId}] Failed to save deployment record:`, insertError.message)
    }

    await event('domain', 'done')
    await event('done', 'done', { url: `https://${deployment.url}`, domain: domainResult?.domain || domain })
    await update({
      status: 'deployed',
      completed_at: new Date().toISOString(),
      error: null,
    })

    return { url: `https://${deployment.url}`, domain: domainResult?.domain || domain }
  } catch (err) {
    console.error(`[${trace_id || jobId}] Deploy job failed:`, err)
    await event('error', 'error', { message: err.message })
    throw err
  }
}

export async function createJob({ shop_id, template_id, subdomain, sections, config, trace_id }) {
  const { data, error } = await supabase
    .from('storefront_deploy_jobs')
    .insert({
      shop_id,
      template_id: template_id || 'classic',
      subdomain: subdomain.toLowerCase(),
      sections: sections && sections.length > 0 ? sections : null,
      config: config || null,
      trace_id,
      status: 'queued',
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to create deploy job: ${error.message}`)
  return data
}

export async function updateJob(id, patch) {
  const { error } = await supabase
    .from('storefront_deploy_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('updateJob error:', error.message)
}

export async function addEvent({ job_id, shop_id, event, status, detail }) {
  const { error } = await supabase.from('storefront_deploy_events').insert({
    job_id,
    shop_id,
    event,
    status,
    detail: detail || null,
  })
  if (error) console.error('addEvent error:', error.message)
}

export async function getJobWithEvents(jobId) {
  const { data: job } = await supabase
    .from('storefront_deploy_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return null
  const { data: events } = await supabase
    .from('storefront_deploy_events')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
  return { ...job, events: events || [] }
}

export async function getJobById(jobId) {
  const { data } = await supabase
    .from('storefront_deploy_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()
  return data || null
}

export async function getJobByVercelRef({ projectId, deploymentId }) {
  let query = supabase
    .from('storefront_deploy_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
  if (projectId) query = query.eq('vercel_project_id', projectId)
  else if (deploymentId) query = query.eq('vercel_deployment_id', deploymentId)
  else return null
  const { data } = await query.maybeSingle()
  return data || null
}

export async function getLatestJob(shopId) {
  const { data } = await supabase
    .from('storefront_deploy_jobs')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

const ACTIVE_STATUSES = ['queued', 'rendering', 'deploying', 'domain']

export async function getActiveJob(shopId) {
  const job = await getLatestJob(shopId)
  if (!job || !ACTIVE_STATUSES.includes(job.status)) return null
  return job
}
