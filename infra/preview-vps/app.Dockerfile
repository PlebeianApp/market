# Prebuilt preview app image.
#
# Bakes the dependency install into the image so a lazy-woken preview boots in
# seconds instead of running `bun install` on every container start. The prior
# compose ran `oven/bun:latest` with `bun install && bun run start:production`,
# a ~5 minute cold start that exceeds the gateway's 15 s wake budget, so the
# first visitor always saw the "preview is starting" page. This image is built
# per deploy on the VPS from the uploaded deploy-package (see
# .github/workflows/preview-deploy.yml, "Build app image on VPS").
#
# Full `bun install` (NOT `--production`): bunfig.toml enables
# `bun-plugin-tailwind`, which needs the `tailwindcss` devDependency to resolve
# `styles/globals.css`'s `@import 'tailwindcss'` at the request-time bundle.
FROM oven/bun:latest
WORKDIR /app
COPY . /app
RUN bun install
