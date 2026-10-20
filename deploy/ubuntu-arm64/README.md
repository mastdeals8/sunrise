# Sunrise Media ERP — WhatsApp Evolution API v2.2.2 (Ubuntu ARM64 Deployment)

This guide provides step-by-step instructions for deploying the official **Evolution API v2.2.2** on a standard **Ubuntu ARM64 (aarch64)** Cloud VM (e.g., Oracle Cloud Free Tier Ampere A1, AWS Graviton, GCP Tau T2A, Hetzner ARM64, or any standard Ubuntu 22.04/24.04 server).

---

## 1. Prerequisites

1. **Ubuntu Server (22.04 or 24.04 LTS)** with ARM64 (`aarch64`) architecture.
   - Verify architecture:
     ```bash
     uname -m
     # Expected output: aarch64
     ```
2. **Public IP & Domain Name** (e.g. `whatsapp.yourdomain.com`) pointing to your VM's public IP address.
3. **Firewall / Ingress Security List**:
   - Open ports **80** (HTTP), **443** (HTTPS), and **8080** (API internal/reverse proxy) in your cloud security list and local firewall:
     ```bash
     sudo ufw allow 80/tcp
     sudo ufw allow 443/tcp
     sudo ufw allow 8080/tcp
     sudo ufw reload
     ```
4. **PostgreSQL Database** (e.g. Supabase, Railway Postgres, or managed cloud PostgreSQL).

---

## 2. Install Docker & Docker Compose on Ubuntu ARM64

If Docker is not already installed on your VM, install official Docker CE:

```bash
sudo apt update && sudo apt install -y ca-certificates curl gnupg lsb-release

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Enable Docker on boot and grant current user permissions
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

---

## 3. Configure Environment Variables

1. Navigate to this directory on the VM:
   ```bash
   cd deploy/ubuntu-arm64
   ```
2. Copy the sample environment file:
   ```bash
   cp env.example .env
   ```
3. Generate a secure random API key:
   ```bash
   openssl rand -hex 24
   ```
4. Edit `.env` with `nano .env` and update the required values:
   - `SERVER_URL`: `https://whatsapp.yourdomain.com` (public HTTPS URL)
   - `AUTHENTICATION_API_KEY`: Paste your generated random key.
   - `DATABASE_CONNECTION_URI`: PostgreSQL connection URI with SSL (e.g. Supabase pooler/direct URI).
   - `WEBHOOK_GLOBAL_URL`: `https://<your-sunrise-erp-domain>/api/webhook/whatsapp`

---

## 4. Reverse Proxy & Automatic SSL (Recommended: Caddy)

To expose Evolution API securely over HTTPS with automated Let's Encrypt SSL certificates, use Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Create `/etc/caddy/Caddyfile`:
```caddy
whatsapp.yourdomain.com {
    reverse_proxy localhost:8080 {
        header_up Host {host}
        header_up X-Real-IP {remote}
        header_up X-Forwarded-For {remote}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

Reload Caddy:
```bash
sudo systemctl reload caddy
```

---

## 5. Launch Evolution API Container

Start Evolution API with Docker Compose:

```bash
docker compose up -d
```

Check running container status:
```bash
docker compose ps
```

View container startup logs:
```bash
docker compose logs -f evolution-api
```

---

## 6. Verify Health & Connectivity

### A. Health Endpoint
From the VM or any terminal:
```bash
curl -i https://whatsapp.yourdomain.com/
```
Expected response:
```json
HTTP/2 200
{"status":200,"message":"Welcome to the Evolution API","version":"2.2.2"}
```

### B. Authenticated QR-Pairing / Instance State Check
Replace `<AUTHENTICATION_API_KEY>` with your key:
```bash
curl -s -H "apikey: <AUTHENTICATION_API_KEY>" https://whatsapp.yourdomain.com/instance/fetchInstances
```

---

## 7. Connect to Sunrise Media ERP

1. Log into your Sunrise ERP as an Administrator.
2. In the navigation sidebar, go to **Settings** -> **WhatsApp Settings** (`/settings/whatsapp`).
3. Fill in the connection settings:
   - **Integration Mode**: `Evolution API (External Baileys Microservice)`
   - **Server URL**: `https://whatsapp.yourdomain.com`
   - **API Key**: `<your-AUTHENTICATION_API_KEY>`
   - **Instance Name**: `sunrise_company_1` (or click Save & Connect to auto-create)
   - **Webhook URL**: `https://<your-erp-domain>/api/webhook/whatsapp`
4. Click **Check Health** -> confirm status shows **Online (v2.2.2)**.
5. Click **Connect WhatsApp** -> scan the rendered QR code with your mobile WhatsApp scanner.

---

## 8. Persistence & Maintenance

- **WhatsApp Session Files:** Stored in Docker named volume `sunrise_evolution_instances` (mapped to `/evolution/instances`).
- **Media Files:** Stored in Docker named volume `sunrise_evolution_store` (mapped to `/evolution/store`).
- **Restart Policy:** Configured as `restart: unless-stopped` to survive VM reboots and system updates.

### Backup Command:
```bash
docker run --rm -v sunrise_evolution_instances:/data -v $(pwd):/backup alpine tar czf /backup/instances_backup_$(date +%Y%m%d).tar.gz /data
```
