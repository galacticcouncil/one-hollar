FROM  node:24-alpine

RUN mkdir -p /home/node/bot && chown -R node:node /home/node/bot
WORKDIR /home/node/bot

COPY ./ ./
RUN chown -R node: /home/node/bot
USER node
RUN npm ci --ignore-scripts


CMD ["node", "index.js"]

