FROM node:20-slim

WORKDIR /app

# Copy workspace configs
COPY package.json package-lock.json .npmrc ./
COPY packages/types/package.json ./packages/types/package.json
COPY packages/agent/package.json ./packages/agent/package.json
COPY packages/bot/package.json ./packages/bot/package.json

# Install all production dependencies (including native prebuilds)
# --ignore-scripts: skip `prepare` (husky) which is dev-only
RUN npm install --omit=dev --ignore-scripts

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
