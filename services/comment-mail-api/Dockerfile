FROM node:20-bookworm-slim

WORKDIR /app

COPY services/comment-mail-api/package.json ./
RUN npm install --omit=dev

COPY services/comment-mail-api/src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/index.js"]
