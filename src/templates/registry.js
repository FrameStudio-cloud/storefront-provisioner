const TEMPLATES = [
  {
    id: 'classic',
    name: 'Classic Storefront',
    description: 'Clean, professional layout with hero slideshow, catalogue grid, announcements, and WhatsApp integration.',
    previewImage: null,
    colors: { primary: '#7c3aed', accent: '#f59e0b' },
  },
]

export function listTemplates() {
  return TEMPLATES.map((t) => ({ ...t }))
}

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || null
}
