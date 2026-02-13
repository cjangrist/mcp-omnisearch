FROM node:24-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --prod=false

COPY . .

RUN pnpm run build

RUN pnpm prune --prod

EXPOSE 8000

ENV NODE_ENV=production
ENV PORT=8000

CMD ["node", "dist/index.js"]
