// Single-page app: no server-side rendering, no prerendering of routes.
// The static adapter emits a `200.html` shell that boots the client router.
export const ssr = false;
export const prerender = false;
