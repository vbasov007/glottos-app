# Deploying to Yandex Cloud

This guide covers deploying the app on a Yandex Cloud Compute VM with Docker, PostgreSQL (Managed Service), and Nginx reverse proxy with SSL.

## Prerequisites

- Yandex Cloud account with billing enabled
- Domain name pointed to Yandex Cloud (A record → VM public IP)
- Google OAuth Client ID (for authentication)
- Gemini API key (for explanations)
- (Optional) Yandex SpeechKit API key, DeepSeek API key

## 1. Create a Managed PostgreSQL Database

1. Go to **Yandex Cloud Console → Managed Service for PostgreSQL**
2. Click **Create cluster**
   - Name: `text-tutor-db`
   - Environment: **Production**
   - PostgreSQL version: **16**
   - Host class: **s3-c2-m8** (2 vCPU, 8 GB) or **b3-c1-m4** for budget
   - Disk: 10 GB SSD
   - Network: select your VPC
3. Under **Databases**, create a database:
   - Name: `text_tutor`
   - Owner: `tutor_user` (set a strong password)
4. Under **Network access**:
   - **Important**: Add either the VM's subnet or its public IP to the allowed hosts
5. After creation, note the connection details from the **Connect** tab:
   ```
   host=rc1a-xxxxx.mdb.yandexcloud.net port=6432 dbname=text_tutor user=tutor_user password=YOUR_PASSWORD sslmode=verify-full
   ```
6. Download the Yandex CA certificate (needed for SSL connections):
   ```bash
   mkdir -p ~/.postgresql
   wget "https://storage.yandexcloud.net/cloud-certs/CA.pem" -O ~/.postgresql/root.crt
   ```

Your `DATABASE_URL` will be:
```
postgresql://tutor_user:YOUR_PASSWORD@rc1a-xxxxx.mdb.yandexcloud.net:6432/text_tutor?sslmode=verify-full&sslrootcert=/root/.postgresql/root.crt
```

## 2. Create a Compute VM

1. Go to **Compute Cloud → Create VM**
   - Name: `text-tutor-vm`
   - Zone: same as your DB cluster (e.g., `ru-central1-a`)
   - Image: **Ubuntu 22.04 LTS**
   - Platform: **Intel Ice Lake**
   - Cores: 2, RAM: 4 GB (or 2 GB for light usage)
   - Disk: 20 GB SSD
   - Public IP: **Static** (allocate or attach one)
   - SSH key: add your public key
2. Note the public IP after creation

### 2.1 Initial VM Setup

```bash
ssh ubuntu@YOUR_VM_IP

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker

# Install Nginx and Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Download Yandex CA certificate (for PostgreSQL SSL)
sudo mkdir -p /root/.postgresql
sudo wget "https://storage.yandexcloud.net/cloud-certs/CA.pem" -O /root/.postgresql/root.crt
```

## 3. Build and Run the Docker Container

### 3.1 Clone the Repository

```bash
cd ~
git clone https://github.com/vbasov007/text-tutor.git
cd text-tutor
```

### 3.2 Create Environment File

```bash
cat > .env << 'EOF'
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_CLIENT_ID=your_google_client_id
DATABASE_URL=postgresql://tutor_user:YOUR_PASSWORD@rc1a-xxxxx.mdb.yandexcloud.net:6432/text_tutor?sslmode=verify-full&sslrootcert=/root/.postgresql/root.crt
APP_URL=https://your-domain.com
ADMIN_EMAIL=your_admin_email@gmail.com

# Optional: set API keys here or configure later in Admin panel
DEEPSEEK_API_KEY=
YANDEX_TTS_API_KEY=
GOOGLE_CLOUD_TTS_CREDENTIALS=
EOF
```

> **Note on `GOOGLE_CLOUD_TTS_CREDENTIALS`**: This is a base64-encoded Google Cloud service account JSON key. To generate:
> 1. Go to Google Cloud Console → IAM → Service Accounts
> 2. Create a key (JSON), download the file
> 3. Encode: `base64 -w0 service-account.json`
> 4. Paste the result as the value

### 3.3 Build the Docker Image

```bash
docker build \
  --build-arg GOOGLE_CLIENT_ID=$(grep GOOGLE_CLIENT_ID .env | cut -d= -f2) \
  -t text-tutor .
```

### 3.4 Run the Container

```bash
docker run -d \
  --name text-tutor \
  --restart unless-stopped \
  --env-file .env \
  -v /root/.postgresql:/root/.postgresql:ro \
  -p 8080:8080 \
  text-tutor
```

Verify it's running:
```bash
docker logs text-tutor
curl http://localhost:8080
```

## 4. Configure Nginx Reverse Proxy

### 4.1 Create Nginx Config

```bash
sudo tee /etc/nginx/sites-available/text-tutor << 'EOF'
server {
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
    }

    listen 80;
}
EOF

sudo ln -sf /etc/nginx/sites-available/text-tutor /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 4.2 Obtain SSL Certificate

```bash
sudo certbot --nginx -d your-domain.com
```

Certbot will automatically modify the Nginx config to add SSL. Auto-renewal is set up by default via systemd timer.

## 5. Google OAuth Setup

In **Google Cloud Console → APIs & Services → Credentials**, edit your OAuth 2.0 Client ID:

- **Authorized JavaScript origins**: add `https://your-domain.com`
- **Authorized redirect URIs**: add `https://your-domain.com` (if needed)

## 6. Firewall Rules

In **Yandex Cloud Console → VPC → Security Groups** (or via the VM's network settings), ensure these inbound ports are open:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22   | TCP      | SSH     |
| 80   | TCP      | HTTP (redirects to HTTPS) |
| 443  | TCP      | HTTPS   |

## 7. Updating the App

```bash
cd ~/text-tutor
git pull

docker build \
  --build-arg GOOGLE_CLIENT_ID=$(grep GOOGLE_CLIENT_ID .env | cut -d= -f2) \
  -t text-tutor .

docker stop text-tutor && docker rm text-tutor

docker run -d \
  --name text-tutor \
  --restart unless-stopped \
  --env-file .env \
  -v /root/.postgresql:/root/.postgresql:ro \
  -p 8080:8080 \
  text-tutor
```

Or as a one-liner:
```bash
cd ~/text-tutor && git pull && docker build --build-arg GOOGLE_CLIENT_ID=$(grep GOOGLE_CLIENT_ID .env | cut -d= -f2) -t text-tutor . && docker stop text-tutor && docker rm text-tutor && docker run -d --name text-tutor --restart unless-stopped --env-file .env -v /root/.postgresql:/root/.postgresql:ro -p 8080:8080 text-tutor
```

## 8. Yandex SpeechKit Setup (Optional)

If using Yandex TTS instead of Google Cloud TTS:

1. Go to **Yandex Cloud Console → Service Accounts**
2. Create a service account with the `ai.speechkit-tts.user` role
3. Create an **API key** for the service account
4. Either:
   - Set `YANDEX_TTS_API_KEY` in `.env` and recreate the container, or
   - Set it in the Admin panel (Admin > TTS Settings > Yandex SpeechKit > API Key)
5. In Admin panel, switch TTS provider to **Yandex SpeechKit** and save

## Troubleshooting

**Container won't start / DB connection hangs:**
- Verify the VM's IP or subnet is in the PostgreSQL cluster's allowed hosts
- Check that the CA certificate is mounted: `docker exec text-tutor ls /root/.postgresql/root.crt`
- Test connectivity: `docker exec text-tutor sh -c "nc -zv rc1a-xxxxx.mdb.yandexcloud.net 6432"`

**502 Bad Gateway from Nginx:**
- Check container is running: `docker ps`
- Check logs: `docker logs text-tutor`

**SSL certificate issues:**
- Renew manually: `sudo certbot renew`
- Check timer: `sudo systemctl status certbot.timer`
