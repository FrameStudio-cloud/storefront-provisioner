// The design catalogue.
//
// A template is a SECTION LIST plus a THEME NAME. Not a folder.
//
// This file used to be a list of 5 template ids, each resolving to a directory
// containing its own App.jsx.ejs - 872, 431, 454, 876 and 270 lines respectively,
// every one carrying its own private copy of Nav, Hero, ProductCard,
// ProductDetail, Footer, WhatsAppFloat and BackToTop. That is roughly 2,900 lines
// of near-duplicate code, and two parallel rendering paths (renderTemplate and
// renderFromSections) meant every bug had to be fixed twice. It is also why the
// sections repo was extracted from classic/App.jsx.ejs and then diverged from it,
// losing the #catalogue anchor in the process.
//
// Now every template renders through the ONE sections path, so adding a design
// means adding an entry here: no files, no components, nothing to keep in sync.
//
// `sections` must be ids that exist in the storefront-sections repo. Adding a new
// kind of block still means writing a section, but that is the only time code is
// touched - and a section is now a self-contained module, so adding one cannot
// break an existing design.
//
// The three optional fields exist only because index.html is shared now:
//   titleSuffix - appended to the <title>
//   schemaType  - the schema.org @type
//   fontHref    - an extra stylesheet, for a template that wants a webfont

const TEMPLATES = [
  {
    id: 'classic',
    name: 'Classic Storefront',
    description: 'Clean, professional layout with hero slideshow, catalogue grid, announcements, and WhatsApp integration.',
    previewImage: null,
    colors: { primary: '#0f766e', accent: '#f59e0b' },
    theme: 'light',
    titleSuffix: ' — Storefront',
    schemaType: 'Store',
    fontHref: '',
    tags: ['general', 'electronics', 'electricals'],
    sections: [
      'announcements',
      'navbar/transparent',
      'hero/slideshow',
      'about',
      'catalogue/grid',
      'footer/4-column',
      'whatsapp-float',
      'back-to-top',
      // The product page is not a choice. Every product card links to it, so a
      // catalogue without one is a dead end.
      'catalogue/product-detail',
      'catalogue/related',
    ],
  },
  {
    id: 'clothing',
    name: 'Fashion Storefront',
    description: 'Lookbook hero, category strips, new arrivals carousel, and featured collection banner for clothing shops.',
    previewImage: null,
    colors: { primary: '#0f172a', accent: '#f59e0b' },
    theme: 'minimal',
    titleSuffix: ' — Fashion',
    schemaType: 'ClothingStore',
    fontHref: '',
    tags: ['clothing', 'wigs', 'beauty'],
    sections: [
      'navbar/solid',
      'hero/split',
      'announcements',
      'categories/strip',
      'catalogue/carousel',
      'featured-collection',
      'footer/4-column',
      'whatsapp-float',
      'catalogue/product-detail',
      'catalogue/related',
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal Storefront',
    description: 'Clean, distraction-free layout with a subtle hero banner, searchable product grid, and compact footer. No-fuss, and square corners.',
    previewImage: null,
    colors: { primary: '#111827', accent: '#9ca3af' },
    theme: 'minimal',
    titleSuffix: ' — Shop',
    schemaType: 'Store',
    fontHref: '',
    tags: ['general', 'electronics', 'electricals', 'stationery', 'books'],
    sections: [
      'navbar/solid',
      'hero/static',
      'catalogue/grid',
      'footer/minimal',
      'whatsapp-float',
      'back-to-top',
      'catalogue/product-detail',
      'catalogue/related',
    ],
  },
  {
    id: 'bold',
    name: 'Bold Storefront',
    description: 'Dark theme with high-contrast typography, spec-heavy product cards, and a full-width gradient hero. Built for electronics and tech shops.',
    previewImage: null,
    colors: { primary: '#f59e0b', accent: '#38bdf8' },
    theme: 'bold',
    titleSuffix: ' — Store',
    schemaType: 'Store',
    fontHref: '',
    tags: ['electronics', 'electricals', 'automotive', 'sports'],
    sections: [
      'announcements',
      'navbar/solid',
      'hero/slideshow',
      'categories/strip',
      'catalogue/grid',
      'featured-collection',
      'footer/4-column',
      'whatsapp-float',
      'back-to-top',
      'catalogue/product-detail',
      'catalogue/related',
    ],
  },
  {
    id: 'modern',
    name: 'Modern Storefront',
    description: 'Editorial layout with generous type, a Ken Burns hero, category browsing and a refined product grid. Suits furniture, groceries and lifestyle shops.',
    previewImage: null,
    colors: { primary: '#059669', accent: '#14b8a6' },
    theme: 'fresh',
    titleSuffix: ' — Storefront',
    schemaType: 'Store',
    fontHref: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Sora:wght@400;500;600;700&display=swap',
    tags: ['general', 'furniture', 'groceries', 'beauty', 'clothing', 'wigs'],
    sections: [
      'announcements',
      'navbar/transparent',
      'hero/slideshow',
      'about',
      'categories/strip',
      'catalogue/grid',
      'featured-collection',
      'footer/4-column',
      'whatsapp-float',
      'back-to-top',
      'catalogue/product-detail',
      'catalogue/related',
    ],
  },
  {
    // Kept for the dashboard's "Build your own" wizard, which sends its own
    // section ids. It renders through the same path as every template above;
    // `sections` is empty because the choice arrives in the request.
    id: 'custom',
    name: 'Custom Storefront',
    description: 'Section-based storefront composed from individual section components.',
    previewImage: null,
    colors: { primary: '#2563eb', accent: '#f59e0b' },
    theme: 'light',
    titleSuffix: ' — Storefront',
    schemaType: 'Store',
    fontHref: '',
    tags: ['general'],
    sections: [],
  },
]

// Bumped to 2 when a template stopped being a directory and became a section list,
// so a dashboard holding a cached manifest can tell the shape changed.
export const MANIFEST_VERSION = '2'

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

// Everything renders through the sections path now, so there is no per-template
// directory and no UI-library variant. Kept as a function because deploy.js calls
// it and it documents why the answer is always the same.
export function getTemplateDir(templateId) {
  return templateId
}

// The former mapping sent sections builds to classic-heroui, which has no site
// config and does not declare the icon package every section uses. With one
// rendering path there is nothing left to vary.
export const TEMPLATE_VARIANTS = {}
