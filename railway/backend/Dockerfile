FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies needed for node-gyp if any
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm ci

# Build Vite client and bundle Express server into dist/index.js
RUN npm run build:legacy

# --- Production runner ---
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create uploads directory
RUN mkdir -p /app/uploads

EXPOSE 5000

CMD ["node", "dist/index.js"]
