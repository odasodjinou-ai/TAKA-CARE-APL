# Image de production du serveur Terra Vida (site + jeu + multijoueur WebSocket)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY public ./public
# Les données (comptes, maisons, paiements) vont dans /data : montez-y un volume persistant
ENV DATA_FILE=/data/db.json
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz || exit 1
CMD ["node", "server/index.js"]
