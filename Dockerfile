FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=3030 FLUJOBOT_DATA=/data
VOLUME /data
EXPOSE 3030
USER node
CMD ["node", "server.js"]
