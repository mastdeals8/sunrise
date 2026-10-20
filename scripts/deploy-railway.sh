#!/usr/bin/env bash
set -e

# ==============================================================================
# Sunrise Media ERP - Railway Deployment Script for Evolution API
# ==============================================================================

echo "========================================================"
echo "Sunrise Media ERP - Evolution API Deployment to Railway"
echo "========================================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EVO_DIR="$PROJECT_ROOT/railway/evolution-api"

cd "$EVO_DIR"

# Check if Railway CLI is installed or run via npx
if command -v railway &> /dev/null; then
  RAILWAY_CMD="railway"
else
  RAILWAY_CMD="npx -y @railway/cli"
fi

echo "Checking Railway authentication..."
if ! $RAILWAY_CMD whoami &> /dev/null; then
  echo ""
  echo "⚠️  Railway CLI is not authenticated."
  echo "Please run one of the following to authenticate:"
  echo "  1) railway login"
  echo "  2) export RAILWAY_TOKEN=<your-railway-token>"
  echo ""
  exit 1
fi

echo "✅ Authenticated with Railway as:"
$RAILWAY_CMD whoami

echo ""
echo "Deploying Evolution API from $EVO_DIR..."
$RAILWAY_CMD up --detach

echo ""
echo "Deployment initiated. Check logs with:"
echo "  $RAILWAY_CMD logs"
