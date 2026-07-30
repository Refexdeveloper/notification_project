# Build Admin UI static assets (backend-api mode only).
FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_USE_BACKEND_API=true
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_USE_BACKEND_API=${VITE_USE_BACKEND_API}

RUN npm run build

# Serve on Cloud Run port 8080
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
