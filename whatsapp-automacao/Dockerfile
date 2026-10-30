FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 TZ=America/Sao_Paulo DATA_DIR=/app/data
RUN apk add --no-cache tzdata
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
RUN node src/patch-baileys.js
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
