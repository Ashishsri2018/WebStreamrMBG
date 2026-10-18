FROM node:24-bookworm AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN npm ci --omit=dev

FROM node:24-bookworm
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=51546

EXPOSE 51546

CMD ["node", "dist/index.js"]
