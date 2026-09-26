-- Domain state for storefront_deployments.
--
-- Why: `domain` used to be written unconditionally by the deploy job, even when
-- Vercel's assignDomain call failed (deploy.js caught the error and fell back to
-- `domainResult?.domain || domain`). A rejected or unassigned domain was therefore
-- indistinguishable from a working one, and the UI linked to it.
--
-- `domain`      = the FQDN we asked Vercel for (unchanged meaning, but now only
--                 trustworthy once domain_status = 'verified')
-- `domain_status` = 'pending'  assigned, TLS cert not issued yet
--                 | 'verified' live, cert valid, safe to publish as website_url
--                 | 'failed'   Vercel refused it (already on another project, etc)
-- `domain_verified` = convenience mirror of domain_status = 'verified'

ALTER TABLE storefront_deployments
  ADD COLUMN IF NOT EXISTS domain_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS domain_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS domain_error TEXT,
  ADD COLUMN IF NOT EXISTS domain_checked_at TIMESTAMPTZ;

-- The one historical deployment predates these columns. Verify it against Vercel
-- rather than assume: the deploy job will refresh this on the next run.
UPDATE storefront_deployments
SET domain_status = 'pending', domain_verified = false, domain_checked_at = now()
WHERE domain IS NOT NULL AND domain_status = 'pending' AND domain_verified = false;
