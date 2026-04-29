#!/usr/bin/env bash
set -euo pipefail

# Local QA helper: runs the full QA gates (lint/build + acceptance phase6 + acceptance phase0).
# Usage:
#   ./scripts/qa_full.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p artifacts/qa

{
  echo "## node version";
  node -v;
  echo "## npm version";
  npm -v;
  echo;
  echo "## npm install";
  npm install;
  echo;
  echo "## npx playwright install --with-deps chromium";
  npx playwright install --with-deps chromium;
  echo;
  echo "## npm run lint:strict";
  npm run lint:strict;
  echo;
  echo "## npm run build";
  npm run build;
  echo;
  echo "## npm run acceptance:phase6";
  npm run acceptance:phase6;
  echo;
  echo "## npm run acceptance:phase0";
  npm run acceptance:phase0;
} 2>&1 | tee "artifacts/qa/qa_full_$(date +%Y%m%d_%H%M%S).log"
