CREATE TABLE IF NOT EXISTS storefront_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL DEFAULT 'classic',
  subdomain TEXT NOT NULL UNIQUE,
  vercel_project_id TEXT,
  url TEXT,
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'provisioning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shop_id)
);

CREATE INDEX IF NOT EXISTS idx_storefront_deployments_shop_id ON storefront_deployments(shop_id);
CREATE INDEX IF NOT EXISTS idx_storefront_deployments_subdomain ON storefront_deployments(subdomain);
