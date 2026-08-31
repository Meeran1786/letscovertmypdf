FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    ghostscript \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
