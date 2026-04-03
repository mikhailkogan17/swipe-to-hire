FROM node:20-slim

WORKDIR /app

# Build tools for native addons (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy workspace configs
COPY package.json package-lock.json .npmrc ./
COPY packages/types/package.json ./packages/types/package.json
COPY packages/agent/package.json ./packages/agent/package.json
COPY packages/bot/package.json ./packages/bot/package.json

# Install production deps, skip lifecycle scripts (husky prepare),
# then rebuild native addons explicitly
RUN npm install --omit=dev --ignore-scripts && \
    npm rebuild better-sqlite3

# Copy source
COPY packages/types/ ./packages/types/
COPY packages/agent/ ./packages/agent/
COPY packages/bot/ ./packages/bot/

# Data dir for SQLite
VOLUME ["/data"]

ENV DB_PATH=/data/swipe-to-hire.db \
    NODE_ENV=production

RUN npm install -g tsx

EXPOSE 3421

CMD ["tsx", "packages/bot/index.ts"]
