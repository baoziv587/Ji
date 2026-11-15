# syntax=docker/dockerfile:1

# ji.dev as a static site: Node only builds it, nginx only serves files.
# Build from the repository root, since the docs pages come from ../../docs:
#   docker build -f apps/website/Dockerfile -t ji-website .
#   docker run --rm -p 8080:80 ji-website

FROM node:24-alpine AS build
ENV CI=true HUSKY=0
RUN npm install --global pnpm@12.5.1
WORKDIR /repo

# Dependencies first, so editing the site or the docs reuses this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm fetch

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter @ji.dev/website
RUN pnpm --filter @ji.dev/website build

FROM nginx:1.29-alpine
COPY apps/website/nginx.conf /etc/nginx/conf.d/default.conf
# dist/client is the whole site; dist/server is only the build-time prerenderer.
COPY --from=build /repo/apps/website/dist/client /usr/share/nginx/html
EXPOSE 80
