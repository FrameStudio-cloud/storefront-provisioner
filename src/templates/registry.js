const TEMPLATES = [
  {
    id: 'classic',
    name: 'Classic Storefront',
    description: 'Clean, professional layout with hero slideshow, catalogue grid, announcements, and WhatsApp integration.',
    previewImage: null,
    colors: { primary: '#7c3aed', accent: '#f59e0b' },
    base: '_shared',
    tags: ['general', 'electronics', 'electricals'],
  },
  {
    id: 'clothing',
    name: 'Fashion Storefront',
    description: 'Lookbook hero, category strips, new arrivals carousel, and featured collection banner for clothing shops.',
    previewImage: null,
    colors: { primary: '#000000', accent: '#f59e0b' },
    base: '_shared',
    tags: ['clothing', 'wigs'],
  },
  {
    id: 'minimal',
    name: 'Minimal Storefront',
    description: 'Clean, distraction-free layout with a subtle hero banner, searchable product grid, and compact footer. Perfect for shops that want a no-fuss online presence.',
    previewImage: null,
    colors: { primary: '#1e293b', accent: '#0ea5e9' },
    base: '_shared',
    tags: ['general', 'electronics', 'electricals'],
  },
  {
    id: 'bold',
    name: 'Bold Storefront',
    description: 'Dark theme with high-contrast typography, spec-heavy product cards, and a full-width gradient hero. Built for electronics and tech-focused shops.',
    previewImage: null,
    colors: { primary: '#0f172a', accent: '#f59e0b' },
    base: '_shared',
    tags: ['electronics', 'electricals'],
  },
  {
    id: 'custom',
    name: 'Custom Storefront',
    description: 'Section-based storefront composed from individual section components. Uses the classic template as base with a generated App.jsx.',
    previewImage: null,
    colors: { primary: '#2563eb', accent: '#f59e0b' },
  },
]

export function listTemplates() {
  return TEMPLATES.map((t) => ({ ...t }))
}

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || null
}
