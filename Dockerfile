# Eldermoor: one Node service serves the client and the WebSocket game server.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY client ./client
ENV NODE_ENV=production
# Hero saves live here. On Railway, mount a Volume at /data so heroes survive redeploys.
ENV EM_SAVE=/data/saves.json
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server/index.js"]
