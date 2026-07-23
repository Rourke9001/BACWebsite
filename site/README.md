# site/

The static site — the Azure SWA deploy artifact (`app_location`). Plain HTML/CSS/JS,
no build step. `/blog/*` is not here: those routes are rewritten to the Functions
API and served from Blob Storage. `staticwebapp.config.json` (redirects, MIME
types, blog/admin routes) lives here too.
