# Build Admin UI static assets (backend-api mode only).
FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Same-origin /api/v1 in production — nginx proxies to backend-api (see nginx.conf.template).
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_USE_BACKEND_API=true
ARG CACHEBUST=1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_USE_BACKEND_API=${VITE_USE_BACKEND_API}

RUN echo "build cache bust: ${CACHEBUST}" && npm run build

# Serve on Cloud Run port 8080
FROM nginx:1.27-alpine

ARG BACKEND_UPSTREAM=https://refex-backend-api-645830234926.asia-south1.run.app
ARG BACKEND_HOST=refex-backend-api-645830234926.asia-south1.run.app
ENV BACKEND_UPSTREAM=${BACKEND_UPSTREAM}
ENV BACKEND_HOST=${BACKEND_HOST}

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
