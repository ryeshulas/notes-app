FROM node:22-alpine

ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1 \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/web

RUN apk add --no-cache su-exec

WORKDIR /app
COPY VERSION ./VERSION
COPY server ./server
COPY web ./web
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

# Starts as root only to fix /data ownership, then runs the server as the unprivileged "node" user.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/server.js"]
