// The site the app belongs to (landing and pricing pages), set at build time with
// VITE_SITE_URL. A self-hosted server has none, so links to it are left out.
const base = (import.meta.env.VITE_SITE_URL || '').replace(/\/$/, '');
export const HAS_SITE = Boolean(import.meta.env.VITE_SITE_URL);

// siteUrl('/pricing') → '/pricing' (or 'https://kanforge.com/pricing'), or null without a site.
export const siteUrl = (path = '/') => (HAS_SITE ? `${base}${path}` : null);
