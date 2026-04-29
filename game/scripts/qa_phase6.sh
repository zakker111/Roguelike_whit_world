#!/usr/bin/env bash
set -euo pipefail

# Local QA helper: runs the same checks the validator expects.
# Usage:
#   ./scripts/qa_phase6.sh

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
  echo "## npm run ci";
  npm run ci;
  echo;
  echo "## npm run acceptance:phase6";
  npm run acceptance:phase6;
} 2>&1 | tee "artifacts/qa/qa_phase6_$(date +%Y%m%d_%H%M%S).log"
