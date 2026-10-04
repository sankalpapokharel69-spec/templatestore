/* WebCraft Studio — front-end configuration.
   Leave WEBCRAFT_API as an empty string in production: the included
   _redirects file proxies /api/* from Cloudflare Pages to your Worker.
   For local development (frontend on http://localhost:3000, worker on
   http://localhost:8787), uncomment the line below and also set
   COOKIE_SAMESITE = "None" in wrangler.toml while developing. */
window.WEBCRAFT_API = ''; // e.g. 'http://localhost:8787'