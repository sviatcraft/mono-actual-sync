# syntax=docker/dockerfile:1

##
## Build frontend
##
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

RUN npm config set registry https://registry.npmjs.org/

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

##
## Install backend deps
##
FROM node:20-alpine AS backend-deps
WORKDIR /app/backend

RUN npm config set registry https://registry.npmjs.org/

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

##
## Runtime image (single container: backend serves frontend static files)
##
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9191
ENV TZ=UTC

# Install timezone database so `TZ=Area/City` works as expected (dates matter for transaction import).
RUN apk add --no-cache tzdata

COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/

# Frontend build output is served from `backend/public`
COPY --from=frontend-build /app/frontend/dist ./backend/public

# Persisted config + Actual API cache live under `backend/data`
VOLUME ["/app/backend/data"]

EXPOSE 9191

CMD ["node", "backend/index.js"]
