import { z } from 'zod'

const themeSchema = z.object({
  primary_color: z.string().max(32).optional(),
  secondary_color: z.string().max(32).optional(),
  accent_color: z.string().max(32).optional(),
  store_name: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  logo_url: z.string().max(500).optional(),
})

// `config` used to carry ui_library, components, toolchain and theme_capabilities.
// All four described the old per-template toolchain world - which UI library the
// design was written against, which component names it used, whether it could take
// a brand colour. None of it is read any more: a template is a section list and a
// theme name, the section registry owns the component names, and every design takes
// a brand colour. They were validated but never consumed, which is worse than
// absent - the schema implied they meant something.
//
// They stay tolerated rather than rejected, since the deployed dashboard still
// sends them and unknown keys are stripped anyway. `config` now means exactly one
// thing: theme overrides.
const configSchema = z.object({
  theme: themeSchema.optional(),
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
