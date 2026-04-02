#!/usr/bin/env bash
# scripts/rpi-setup.sh — first-time deploy to Raspberry Pi
#
# Usage (from your local machine):
#   bash scripts/rpi-setup.sh
#
# Prerequisites:
#   - SSH access to pi@raspberrypi.local (key-based preferred)
#   - .env file ready locally (will be uploaded)
#
# What it does on the RPi:
#   1. Installs Docker + Docker Compose plugin (if missing)
#   2. Installs Node.js 22 (if missing)
#   3. Clones the repo into /home/pi/swipe-to-hire
#   4. Uploads .env
#   5. Starts containers via docker-compose up -d --build

set -euo pipefail

RPI_HOST="${RPI_HOST:-pi@raspberrypi.local}"
RPI_DIR="${RPI_DIR:-/home/pi/swipe-to-hire}"
REPO_URL="${REPO_URL:-https://github.com/mikhailkogan17/swipe-to-hire.git}"

echo "Setting up swipe-to-hire on ${RPI_HOST}..."

# ── Upload .env ───────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo ".env not found locally. Copy .env.example and fill in values first."
  exit 1
fi
echo "Uploading .env..."
scp .env "${RPI_HOST}:${RPI_DIR}/.env" 2>/dev/null || true

# ── Bootstrap RPi ─────────────────────────────────────────
ssh "${RPI_HOST}" bash <<REMOTE
set -euo pipefail

# Install Docker if missing
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker pi
  echo "Docker installed. You may need to log out and back in."
fi

# Install Node 22 if missing or old
NODE_VER=\$(node --version 2>/dev/null | cut -c2- | cut -d. -f1 || echo "0")
if [ "\$NODE_VER" -lt 22 ]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Clone or update repo
if [ -d "${RPI_DIR}/.git" ]; then
  echo "Repo exists — pulling latest..."
  cd "${RPI_DIR}" && git pull
else
  echo "Cloning repo..."
  git clone "${REPO_URL}" "${RPI_DIR}"
  cd "${RPI_DIR}"
fi

# Start containers
cd "${RPI_DIR}"
docker compose up -d --build

echo "Setup complete. Running containers:"
docker compose ps
REMOTE

echo ""
echo "Done. swipe-to-hire is running on ${RPI_HOST}"
echo "To deploy updates: npm run release"
