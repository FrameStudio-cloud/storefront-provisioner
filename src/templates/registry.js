const TEMPLATES = [
  {
    id: 'classic',
    name: 'Classic Storefront',
    description: 'Clean, professional layout with hero slideshow, catalogue grid, announcements, and WhatsApp integration.',
    previewImage: null,
    colors: { primary: '#7c3aed', accent: '#f59e0b' },
    base: '_shared',
    tags: ['general', 'electronics', 'electricals'],
    uiLibrary: 'cite_ui',
    themeCapabilities: 'basic',
  },
  {
    id: 'clothing',
    name: 'Fashion Storefront',
    description: 'Lookbook hero, category strips, new arrivals carousel, and featured collection banner for clothing shops.',
    previewImage: null,
    colors: { primary: '#000000', accent: '#f59e0b' },
    base: '_shared',
    tags: ['clothing', 'wigs'],
    uiLibrary: 'cite_ui',
    themeCapabilities: 'basic',
  },
  {
    id: 'minimal',
    name: 'Minimal Storefront',
    description: 'Clean, distraction-free layout with a subtle hero banner, searchable product grid, and compact footer. Perfect for shops that want a no-fuss online presence.',
    previewImage: null,
    colors: { primary: '#1e293b', accent: '#0ea5e9' },
    base: '_shared',
    tags: ['general', 'electronics', 'electricals'],
    uiLibrary: 'cite_ui',
    themeCapabilities: 'full',
  },
  {
    id: 'bold',
    name: 'Bold Storefront',
    description: 'Dark theme with high-contrast typography, spec-heavy product cards, and a full-width gradient hero. Built for electronics and tech-focused shops.',
    previewImage: null,
    colors: { primary: '#0f172a', accent: '#f59e0b' },
    base: '_shared',
    tags: ['electronics', 'electricals'],
    uiLibrary: 'cite_ui',
    themeCapabilities: 'full',
  },
  {
    id: 'modern',
    name: 'Modern Storefront',
    description: 'Clean, minimal layout with editorial typography (Sora + Inter), glass navigation, Ken Burns hero, scroll-reveal animations, and a refined product grid.',
    previewImage: null,
    colors: { primary: '#111111', accent: '#6366f1' },
    base: '_shared',
    tags: ['general', 'electronics', 'electricals', 'clothing', 'wigs', 'beauty', 'furniture', 'groceries'],
    uiLibrary: 'cite_ui',
    themeCapabilities: 'full',
  },
  {
    id: 'custom',
    name: 'Custom Storefront',
    description: 'Section-based storefront composed from individual section components. Uses the classic template as base with a generated App.jsx.',
    previewImage: null,
    colors: { primary: '#2563eb', accent: '#f59e0b' },
    // A sections build still needs the project scaffold, and the single most
    // important file in it is src/config/site.js.ejs — every generated App.jsx
    // starts with `import shopConfig from './config/site'`. Without `base` here the
    // scaffold was not walked at all, so that import resolved to nothing and the
    // Vercel build failed with "failed to resolve import". That is why the custom
    // builder could never produce a working site.
    base: '_shared',
    tags: ['general'],
    uiLibrary: 'cite_ui',
    themeCapabilities: 'basic',
  },
]

// Available toolchain variants per template.
// The key is the toolchain id sent by the dashboard; the value is the template directory suffix.
//
// classic:heroui is deliberately kept, but it is a *whole-template* rendering. A
// sections build generates its own App.jsx in plain Tailwind + Phosphor, so the
// variant must never be applied there — classic-heroui has no src/config/site.js.ejs
// and its package.json does not even list @phosphor-icons/react, which every
// generated section imports.
const TEMPLATE_VARIANTS = {
  classic: {
    heroui: 'classic-heroui',
  },
}

// Canonical manifest version. Bump when the registry contract changes so the
// dashboard (and any cache) can detect stale manifests.
export const MANIFEST_VERSION = '1'

// Legacy ids sent by older dashboard builds mapped to their canonical template.
const ALIASES = {
  fashion: 'clothing',
}

export function listTemplates() {
  return TEMPLATES.map((t) => ({ ...t }))
}

export function listAliases() {
  return { ...ALIASES }
}

export function getTemplate(id) {
  if (!id) return null
  const canonicalId = ALIASES[id] || id
  return TEMPLATES.find((t) => t.id === canonicalId) || null
}

export function getTemplateDir(baseTemplateId, toolchain) {
  const variants = TEMPLATE_VARIANTS[baseTemplateId]
  if (toolchain && variants && variants[toolchain]) {
    return variants[toolchain]
  }
  return baseTemplateId
}