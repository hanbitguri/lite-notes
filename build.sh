#!/bin/sh
set -e
cd "$(dirname "$0")"
rm -rf dist
npx esbuild src/main.js --bundle --splitting --format=esm --minify --outdir=dist --entry-names=[name] --chunk-names=c-[hash] --target=es2020,safari15 --legal-comments=none
