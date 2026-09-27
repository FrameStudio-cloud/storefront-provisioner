// Storefront themes.
//
// A theme is a set of CSS custom properties. Sections are written once and never
// hardcode a brand colour: they use Tailwind's gray scale, and tailwind.config.js
// in a generated project remaps that scale onto these variables. Changing a theme
// therefore restyles every section at once, with no section edits — which is the
// reason the five templates used to be 2,903 lines of near-duplicate App.jsx.
//
// Values are chosen so a new theme is a copy-and-change, not a decision. If you
// are adding a template you should not need to come here: reference a preset by
// name. Only add an entry when no existing preset fits.

/** @typedef {{
 *   bg: string, surface: string, text: string, body: string, muted: string,
 *   subtle: string, line: string, lineStrong: string, brand: string,
 *   brandText: string, accent: string, radius: string, font: string, headingFont: string,
 * }} StorefrontTheme */

/** @type {Record<string, StorefrontTheme>} */
export const THEMES = {
  light: {
    bg: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    body: '#475569',
    muted: '#94a3b8',
    subtle: '#cbd5e1',
    line: '#e2e8f0',
    lineStrong: '#cbd5e1',
    brand: '#0f766e',
    brandText: '#ffffff',
    accent: '#f59e0b',
    radius: '0.5rem',
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    headingFont: 'inherit',
  },

  warm: {
    bg: '#fffdf8',
    surface: '#fef6ec',
    text: '#3f2d16',
    body: '#7a5c3d',
    muted: '#b39471',
    subtle: '#d9c3a5',
    line: '#f0e2cd',
    lineStrong: '#dcc7a8',
    brand: '#b45309',
    brandText: '#ffffff',
    accent: '#d97706',
    radius: '0.75rem',
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    headingFont: 'Georgia, "Times New Roman", serif',
  },

  minimal: {
    bg: '#ffffff',
    surface: '#ffffff',
    text: '#111827',
    body: '#6b7280',
    muted: '#9ca3af',
    subtle: '#d1d5db',
    line: '#f3f4f6',
    lineStrong: '#e5e7eb',
    brand: '#111827',
    brandText: '#ffffff',
    accent: '#9ca3af',
    // Square corners. 0 rather than 0rem so the Tailwind class reads plainly.
    radius: '0',
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    headingFont: 'inherit',
  },

  bold: {
    bg: '#0b1120',
    surface: '#111827',
    text: '#f8fafc',
    body: '#cbd5e1',
    muted: '#64748b',
    subtle: '#475569',
    line: '#1e293b',
    lineStrong: '#334155',
    brand: '#f59e0b',
    brandText: '#0b1120',
    accent: '#38bdf8',
    radius: '1rem',
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    headingFont: 'inherit',
  },

  fresh: {
    bg: '#f6fefb',
    surface: '#ecfdf5',
    text: '#064e3b',
    body: '#3f6b5c',
    muted: '#7fae9c',
    subtle: '#b7d9cb',
    line: '#d1fae5',
    lineStrong: '#a7f3d0',
    brand: '#059669',
    brandText: '#ffffff',
    accent: '#14b8a6',
    radius: '1.25rem',
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    headingFont: 'inherit',
  },
}

export const DEFAULT_THEME = 'light'

/** Resolve a theme name, or a literal theme object, to a full theme. */
export function resolveTheme(theme) {
  if (theme && typeof theme === 'object') {
    const base = THEMES[DEFAULT_THEME]
    return { ...base, ...theme }
  }
  return THEMES[theme] || THEMES[DEFAULT_THEME]
}

export function listThemes() {
  return Object.keys(THEMES)
}

// The gray scale remap. Sections are written against Tailwind's default palette
// (text-gray-900, bg-gray-50, border-gray-100 and so on — ~124 uses across the
// 19 sections) because that is what a developer reaches for by default. Mapping
// that scale here means the sections never had to change to become themeable.
//
// 200 and 300 are separate from 100 because sections use all three: 100 is a
// section wash, 200/300 are borders, and a theme may want them to differ.
export function grayScaleFor(theme) {
  return {
    50: theme.surface,
    100: theme.surface,
    200: theme.line,
    300: theme.lineStrong,
    400: theme.muted,
    500: theme.muted,
    600: theme.body,
    700: theme.body,
    800: theme.text,
    900: theme.text,
  }
}
