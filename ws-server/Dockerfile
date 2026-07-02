FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.mjs ./

RUN mkdir -p /app/data

ENV PORT=8787
ENV DATA_DIR=/app/data
EXPOSE 8787

VOLUME ["/app/data"]

CMD ["node", "server.mjs"]
