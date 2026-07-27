# Static site: nginx serves the generated public/index.html.
# The HTML is produced by `node dist/index.js` (in CI or locally) before deploy.
FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/
EXPOSE 80
