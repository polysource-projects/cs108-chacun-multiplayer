FROM oven/bun:1 as base

WORKDIR /app

COPY package.json bun.lockb ./

RUN bun install --frozen-lockfile --production

COPY . .

ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
#RUN bunx prisma generate

#EXPOSE 3000
#ENTRYPOINT [ "bun", "run", "index.ts" ]
#ENTRYPOINT [ "tail", "-f", "/dev/null" ]
