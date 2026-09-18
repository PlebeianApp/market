# Prebuilt preview app image.
#
# Bakes the dependency install into the image so a lazy-woken preview boots in
# seconds instead of running `bun install` on every container start. The prior
# compose ran `oven/bun:latest` with `bun install && bun run start:production`,
# a ~5 minute cold start that exceeds the gateway's 15 s wake budget, so the
# first visitor always saw the "preview is starting" page.
#
# Built ON THE CI RUNNER, not on the preview host, and shipped with
# `docker save | gzip | ssh 'gunzip | docker load'` (see
# .github/workflows/preview-deploy.yml, "Build app image on CI runner" /
# "Ship app image to VPS"). Building on the runner is deliberate: an on-host
# build leaves the preview VPS carrying a full build context, build cache and
# dangling layers per commit, which filled its disk and pushed the deploy job
# past its timeout.
#
# The dependency layer is ordered first so it is cached across deploys that
# share a lockfile: the manifests are copied in, `bun install` runs, and only
# then is the rest of the source copied. Full `bun install` (NOT
# `--production`): bunfig.toml enables `bun-plugin-tailwind`, which needs the
# `tailwindcss` devDependency to resolve `styles/globals.css`'s
# `@import 'tailwindcss'` at the request-time bundle.
FROM oven/bun:latest
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install
# Build identity, baked into the image ENV so the running preview reports the
# exact commit it was built from (the deploy health check asserts it via
# /api/config). Kept after `RUN bun install` so a new commit does not
# invalidate the dependency-layer cache.
ARG APP_COMMIT_SHA=""
ENV APP_COMMIT_SHA=${APP_COMMIT_SHA}
COPY . /app
