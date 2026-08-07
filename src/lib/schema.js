import { z } from 'zod'

const themeSchema = z.object({
  primary_color: z.string().max(32).optional(),
  secondary_color: z.string().max(32).optional(),
  accent_color: z.string().max(32).optional(),
  store_name: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  logo_url: z.string().max(500).optional(),
})

const configSchema = z.object({
  ui_library: z.string().max(64).optional(),
  components: z.record(z.string(), z.string()).optional(),
  toolchain: z.object({
    ui: z.string().max(64).optional(),
    icons: z.string().max(64).optional(),
    fonts: z.array(z.string().max(64)).max(12).optional(),
  }).optional(),
  theme: themeSchema.optional(),
  theme_capabilities: z.record(z.string(), z.boolean()).optional(),
})

// The dashboard sends a known, fixed payload shape. Unknown keys are stripped
// rather than rejected so forward-compatible additions don't 400.
export const deploySchema = z.object({
  shop_id: z.string().min(8).max(64),
  template_id: z.string().min(1).max(64).optional(),
  subdomain: z.string().min(2).max(63),
  sections: z.array(z.string().min(1).max(64)).max(40).optional(),
  config: configSchema.optional(),
})

export const shopIdSchema = z.string().min(8).max(64)
