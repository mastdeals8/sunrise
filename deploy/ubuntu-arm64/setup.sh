#!/usr/bin/env bash
set -e

# ==============================================================================
# Sunrise Media ERP — Ubuntu ARM64 Cloud VM Setup Helper
# ==============================================================================

echo "================================================================="
echo " Sunrise Media ERP — WhatsApp Evolution API v2.2.2 Setup (ARM64) "
echo "================================================================="

ARCH="$(uname -m)"
echo "Detected system architecture: $ARCH"

if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
  echo "ℹ️  Note: System architecture is $ARCH. Evolution API multi-arch image also supports x86_64."
fi

# Check Docker installation
if ! command -v docker &> /dev/null; then
  echo ""
  echo "⚠️  Docker is not installed."
  echo "To install Docker on Ubuntu, run:"
  echo "  sudo apt update && sudo apt install -y ca-certificates curl gnupg"
  echo "  sudo install -m 0755 -d /etc/apt/keyrings"
  echo "  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg"
  echo "  sudo chmod a+r /etc/apt/keyrings/docker.gpg"
  echo "  echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \"\$VERSION_CODENAME\") stable\" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null"
  echo "  sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
  echo ""
  exit 1
fi

echo "✅ Docker is installed: $(docker --version)"

# Check .env existence
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  if [ -f "$SCRIPT_DIR/env.example" ]; then
    echo "Creating .env from env.example..."
    cp "$SCRIPT_DIR/env.example" "$SCRIPT_DIR/.env"
    # Auto-generate a secure random API key
    if command -v openssl &> /dev/null; then
      RAND_KEY=$(openssl rand -hex 24)
      sed -i "s/replace_with_your_secure_random_api_key_here/$RAND_KEY/" "$SCRIPT_DIR/.env" 2>/dev/null || true
      echo "✅ Generated secure random API key in .env"
    fi
    echo "⚠️  Please edit $SCRIPT_DIR/.env and set your DATABASE_CONNECTION_URI and SERVER_URL before starting."
  fi
else
  echo "✅ Configuration file .env found."
fi

echo ""
echo "To launch Evolution API, run:"
echo "  cd $SCRIPT_DIR"
echo "  docker compose up -d"
echo ""
echo "To verify logs:"
echo "  docker compose logs -f evolution-api"
echo ""
