FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=3030 FLUJOBOT_DATA=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3030
# Un volumen montado llega como root: se da permiso a /data y el servidor corre como usuario node.
CMD ["sh", "-c", "chown -R node:node /data && exec su-exec node node server.js"]
