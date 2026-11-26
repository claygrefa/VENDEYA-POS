FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.node.json ./
COPY src/server/cloud ./src/server/cloud
COPY src/server/services/licencia/licencia.token.ts ./src/server/services/licencia/
COPY src/server/services/telemetria/telemetria.util.ts ./src/server/services/telemetria/
COPY src/shared/types/telemetria.types.ts ./src/shared/types/
RUN ./node_modules/.bin/tsc -p src/server/cloud/deploy/tsconfig.json

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY src/server/cloud/deploy/001.sql ./dist/src/server/cloud/deploy/001.sql
USER node
EXPOSE 8080
ENTRYPOINT ["node", "dist/src/server/cloud/cli.js"]
CMD ["serve"]
