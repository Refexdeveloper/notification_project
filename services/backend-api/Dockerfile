FROM node:20-bookworm-slim

WORKDIR /app

COPY services/backend-api/package.json ./
RUN npm install --omit=dev

COPY services/backend-api/src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/index.js"]
