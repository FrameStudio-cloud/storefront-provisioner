import { supabase } from '../db.js'
import { fetchShopData } from './shop-fetcher.js'
import { renderFromSections } from './renderer.js'
import { createProject, createDeployment, assignDomain, getDomain, waitForDomainVerification, deleteProject, registerProjectWebhook } from '../vercel.js'
import { formatDomain, projectNameFor } from './domain.js'
import { resolveRootDomain } from './platform-domains.js'
import { isManagedWebsiteUrl, DEFAULT_PLATFORM_DOMAIN } from './website-url.js'
import { getTemplate } from '../templates/registry.js'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const TEMPLATES_DIR = join(__dirname, '..', 'templates')

// How long to wait for Vercel to issue the TLS cert before giving up on verifying
// and leaving the row 'pending'. Runs in the long-lived worker, not a request.
const DOMAIN_VERIFY_TIMEOUT_MS = parseInt(
  process.env.DOMAIN_VERIFY_TIMEOUT_MS || '90000',
  10
)

// The provisioner owns store_settings.website_url from here on: it is the only
// component that knows the verified storefront address, and asking the owner to
// copy it into a settings box by hand was the actual manual step in the flow —
// and an easy one to get wrong (one shop had website_url pointing at a completely
// different storefront).
//
// Overwrite only values we could have written ourselves (empty, a Vercel fallback
// host, or an address under our own platform root). Anything else is presumed to
// be a domain the shop owner set deliberately, and is left alone.
const PLATFORM_DOMAIN_SUFFIX = process.env.PLATFORM_DOMAIN || DEFAULT_PLATFORM_DOMAIN

async function syncWebsiteUrl(shopId, url, trace) {
  try {
    const { data: current, error: readError } = await supabase
      .from('store_settings')
      .select('website_url')
      .eq('shop_id', shopId)
      .maybeSingle()

    if (readError) {
      console.warn(`[${trace}] Could not read website_url before sync:`, readError.message)
      return false
    }

    if (!isManagedWebsiteUrl(current?.website_url)) {
      console.log(
        `[${trace}] website_url is "${current.website_url}" (not ours) — leaving it untouched`
      )
      return false
    }

    if (current?.website_url === url) return true

    const { error } = await supabase
      .from('store_settings')
      .update({ website_url: url })
      .eq('shop_id', shopId)

    if (error) {
      console.warn(`[${trace}] Failed to write website_url:`, error.message)
      return false
    }

    console.log(`[${trace}] website_url synced to ${url}`)
    return true
  } catch (err) {
    // Never fail a deploy because of a convenience sync.
    console.warn(`[${trace}] syncWebsiteUrl error:`, err.message)
    return false
  }
}

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

    // Resolve the root domain and the exact FQDN BEFORE rendering. The templates
    // need both for canonical/og:url and JSON-LD, and they used to guess the host
    // by slugifying the shop name with the platform root baked in — which also
    // produced "https://https://..." because store_settings.website_url already
    // carries a scheme.
    const rootDomain = await resolveRootDomain({ root: config?.root_domain })
    const domain = formatDomain(subdomain, rootDomain)
    if (!domain) throw new Error(`Invalid subdomain: ${subdomain}`)

    // The project scaffold is always _shared, and it is the ONLY directory now.
    //
    // There used to be a per-template `base` field plus a per-template directory
    // holding its own App.jsx, styles, tailwind config and index.html - about 2,900
    // lines across five designs, each carrying a private copy of every component.
    // A template is now data (a section list and a theme name), so it has nothing
    // to point at. The custom template simply never declared `base`, which is how
    // the scaffold went unwalked and the generated App.jsx ended up importing a
    // site config that was never emitted.
    const SCAFFOLD_DIR = '_shared'
    if (!existsSync(join(TEMPLATES_DIR, SCAFFOLD_DIR))) {
      throw new Error(
        `Project scaffold "${SCAFFOLD_DIR}" is missing from src/templates — cannot build any site.`
      )
    }

    // The scaffold every emitted project needs: the generated App.jsx imports the
    // site config, and main.jsx boots it. Checked here so a missing file names
    // itself, rather than letting Vercel report an unresolved import later.
    const requiredScaffold = ['src/config/site.js.ejs', 'src/main.jsx.ejs', 'index.html.ejs']
    const missingScaffold = requiredScaffold.filter(
      (rel) => !existsSync(join(TEMPLATES_DIR, SCAFFOLD_DIR, rel))
    )
    if (missingScaffold.length > 0) {
      throw new Error(
        `Project scaffold "${SCAFFOLD_DIR}" is missing: ${missingScaffold.join(', ')}. ` +
        `No storefront can build without these.`
      )
    }

    // ONE rendering path. A template declares its sections and a theme; the
    // dashboard's "Build your own" wizard sends its own section ids instead.
    // Either way the same composer produces the site, so there is no second
    // implementation to keep in step — which is what let the two diverge and
    // lose the #catalogue anchor from one side only.
    const effectiveSections = (sections && sections.length > 0)
      ? sections
      : (template.sections || [])

    if (!effectiveSections.length) {
      throw new Error(
        `Template "${template.id}" has no sections. Add a "sections" list to it in src/templates/registry.js.`
      )
    }

    const renderVars = {
      ...(config || {}),
      rootDomain,
      domain,
      theme_name: template.theme || config?.theme_name,
      // The shared index.html is the only thing a template still varies, and only
      // by these three values. Everything else about a design is its section list.
      titleSuffix: template.titleSuffix || '',
      schemaType: template.schemaType || 'Store',
      fontHref: template.fontHref || '',
    }

    const sectionsCwd = join(process.cwd(), 'storefront-sections', 'sections')
    const sectionsLegacy = join(TEMPLATES_DIR, '..', '..', 'storefront-sections', 'sections')
    const sectionsDir = process.env.SECTIONS_DIR
      || (existsSync(sectionsCwd) ? sectionsCwd : sectionsLegacy)

    if (!existsSync(sectionsDir)) {
      throw new Error(
        `The sections repo was not found at ${sectionsDir}. It is cloned during the build; ` +
        `check the Render build log.`
      )
    }

    const blueprint = buildBlueprint(effectiveSections)
    const renderedFiles = renderFromSections(
      SCAFFOLD_DIR, sectionsDir, rawData, blueprint, null, renderVars
    )
    const vercelFiles = Object.entries(renderedFiles).map(([path, data]) => ({
      file: path.replace(/\\/g, '/'),
      data: Buffer.from(data).toString('base64'),
      encoding: 'base64',
    }))

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

    // Compared as a full FQDN, not a label, for the same reason as the taken
    // check below. A shop whose live address is acme.keel.framestudio.co.ke has
    // genuinely moved if the requested address is acme.othershop.co.ke, and the
    // label-only comparison would have waved that through.
    if (existing.data && existing.data.domain && existing.data.domain !== domain) {
      throw new Error('Shop already has a storefront with a different subdomain. Delete it first.')
    }

    // Availability is a property of the FQDN, not the label: with two root
    // domains "acme" is free on both. Matches storefront_deployments_domain_uniq
    // and is_subdomain_taken — if these three disagree the owner is told a
    // subdomain is free and the insert then dies on the unique index.
    const taken = await supabase
      .from('storefront_deployments')
      .select('id')
      .eq('domain', domain)
      .neq('shop_id', shopId)
      .limit(1)
      .maybeSingle()
    if (taken.data) throw new Error(`"${domain}" is already taken`)

    let deployment
    let projectId

    if (existing.data) {
      projectId = existing.data.vercel_project_id
      deployment = await createDeployment(subdomain.toLowerCase(), projectId, vercelFiles, envVars)
    } else {
      const projectName = projectNameFor(subdomain, rootDomain)
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
    let domainStatus = 'failed'
    let domainError = null
    let domainVerified = false

    // The old code caught every assignDomain failure, logged a warning, and then
    // wrote `domainResult?.domain || domain` to the row — so a refused or
    // unassigned domain was recorded exactly like a working one, and the UI
    // linked to it. Vercel also rejects re-assigning a domain that is already on
    // this project, which is the NORMAL path on redeploy, so a blanket "warn and
    // carry on" is what hid the real failures. Separate the two cases.
    try {
      await assignDomain(projectId, domain)
      domainStatus = 'pending'
    } catch (err) {
      const already = await getDomain(projectId, domain).catch(() => null)
      if (already?.found) {
        console.log(`[${trace_id || jobId}] Domain already assigned to this project (redeploy): ${domain}`)
        domainStatus = 'pending'
      } else {
        domainError = err.message
        console.warn(`[${trace_id || jobId}] Domain assignment failed:`, err.message)
      }
    }

    if (domainStatus === 'pending') {
      const check = await waitForDomainVerification(projectId, domain, {
        timeoutMs: DOMAIN_VERIFY_TIMEOUT_MS,
      })
      domainResult = { domain: check.domain || domain, verified: check.verified }
      if (check.verified) {
        domainStatus = 'verified'
        domainVerified = true
      } else {
        // Assigned but the cert has not landed yet. This is not a failure — DNS
        // may still be propagating. Leave it pending so a later status read can
        // re-check, and keep the row honest about the fact it is not live yet.
        domainStatus = 'pending'
        console.warn(
          `[${trace_id || jobId}] Domain ${domain} assigned but not verified after ` +
          `${Math.round(DOMAIN_VERIFY_TIMEOUT_MS / 1000)}s — TLS still issuing`
        )
      }
    }

    const domainFields = {
      domain: domainResult?.domain || domain,
      domain_status: domainStatus,
      domain_verified: domainVerified,
      domain_error: domainError,
      domain_checked_at: new Date().toISOString(),
    }

    // Only publish a verified address. A pending or failed domain must never
    // become the shop's website_url, or the owner gets a dead link from a
    // successful-looking deploy.
    if (domainVerified) {
      await syncWebsiteUrl(shopId, `https://${domainFields.domain}/`, trace_id || jobId)
    }

    if (existing.data) {
      const { error: updateError } = await supabase
        .from('storefront_deployments')
        .update({
          template_id: template.id,
          url: `https://${deployment.url}`,
          ...domainFields,
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
        ...domainFields,
        status: 'deployed',
      })
      if (insertError) console.error(`[${trace_id || jobId}] Failed to save deployment record:`, insertError.message)
    }

    await event('domain', 'done', { domain: domainFields.domain, status: domainStatus })
    await event('done', 'done', { url: `https://${deployment.url}`, domain: domainFields.domain })
    await update({
      status: 'deployed',
      completed_at: new Date().toISOString(),
      error: null,
    })

    return { url: `https://${deployment.url}`, domain: domainFields.domain, domainStatus }
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
