FROM node:24-bookworm-slim

WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/victorzywei/NodeHubs"

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN npm ci

COPY . .

RUN npm run build

ENV PORT=3000

EXPOSE 3000

CMD ["node", "apps/api/dist/node/node.js"]
