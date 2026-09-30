// The app runs under one of two base paths, fixed for each page load:
//   /app/w/<slug>/...  inside a workspace (every API call names it in X-Workspace)
//   /app/...           outside one: sign-in, choosing or creating a workspace
// Moving between them is a full page load, so nothing from one workspace (state,
// caches, in-flight requests) can carry over into another.

const WORKSPACE_PATH = /^\/app\/w\/([a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,39})(?=\/|$)/;

const match = window.location.pathname.match(WORKSPACE_PATH);
export const WORKSPACE_SLUG = match ? match[1] : null;
export const ROUTER_BASENAME = WORKSPACE_SLUG ? `/app/w/${WORKSPACE_SLUG}` : '/app';

export const workspaceUrl = (slug, path = '/') => `/app/w/${slug}${path}`;

// Full page load to a URL under /app.
export const goTo = (url) => window.location.assign(url);

// Only same-site workspace paths are accepted as a post-sign-in destination.
export const isWorkspacePath = (url) => typeof url === 'string' && WORKSPACE_PATH.test(url);

// An invite link: /app/invite#<token>. The token stays in the #fragment, which
// browsers never send to the server, so it stays out of access logs.
const INVITE_PATH = /^\/app\/invite#[A-Za-z0-9_-]{32}$/;
export const isInvitePath = (url) => typeof url === 'string' && INVITE_PATH.test(url);
export const inviteUrl = (token) => `${window.location.origin}/app/invite#${token}`;

const LAST_KEY = 'kanforge.lastWorkspace';

export function rememberWorkspace(slug) {
  try {
    localStorage.setItem(LAST_KEY, slug);
  } catch { /* storage may be unavailable */ }
}

export function lastWorkspace() {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
