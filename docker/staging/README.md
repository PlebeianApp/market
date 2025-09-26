# Plebeian Market Staging Docker Setup

This directory contains the Docker configuration for running Plebeian Market in a staging environment. The setup includes a Nostr relay (plebeian-orly) running as a systemd service and the web application.

## Prerequisites

- Docker installed on your system
- At least 2GB of available RAM
- Ports 3000 and 10547 available on your host machine

## Quick Start

### 1. Build the Docker Image

From the project root directory, run:

```bash
docker build -f docker/staging/Dockerfile -t plebeian-market-staging .
```

This will:
- Create an Ubuntu 22.04 container with systemd
- Install Git, Go 1.25.1, and Bun
- Copy the project files
- Set up the plebeian-orly relay
- Seed the database
- Configure the relay as a systemd service

### 2. Run the Container

```bash
docker run -d \
  --name plebeian-market-staging \
  --privileged \
  -p 3000:3000 \
  -p 10547:10547 \
  -v plebeian-staging-data:/tmp/plebeian \
  -v /path/to/next.orly.dev:/app/orly \
  plebeian-market-staging
```

**Note:** The `--privileged` flag is required for systemd to work properly in the container.

### 3. Start the Web Application

After the container is running, execute the following to start the web app:

```bash
docker exec -it plebeian-market-staging bash -c "cd /app && bun run dev"
```

### 4. Access the Application

- **Web Application**: http://localhost:3000
- **Relay**: ws://localhost:10547 (WebSocket connection)

## Container Services

The container runs the following services:

### Plebeian Relay (plebeian-orly)
- **Port**: 10547
- **Protocol**: WebSocket
- **Data Directory**: `/app/docker/staging/data` (persisted via Docker volume)
- **Management**: Managed by systemd, auto-starts on container boot
- **Status Check**: `docker exec plebeian-market-staging systemctl status plebeian-relay`

### Web Application
- **Port**: 3000
- **Framework**: React with Bun runtime
- **Database**: Seeded with initial data during build

## Container Management Commands

### Check Container Status
```bash
docker ps | grep plebeian-market-staging
```

### View Container Logs
```bash
docker logs plebeian-market-staging
```

### Access Container Shell
```bash
docker exec -it plebeian-market-staging bash
```

### Check Relay Service Status
```bash
docker exec plebeian-market-staging systemctl status plebeian-relay
```

### Restart Relay Service
```bash
docker exec plebeian-market-staging systemctl restart plebeian-relay
```

### Stop and Remove Container
```bash
docker stop plebeian-market-staging
docker rm plebeian-market-staging
```

## Persistent Data

The relay data is stored in a Docker volume named `plebeian-staging-data`. This ensures your relay database persists between container restarts.

To backup the data:
```bash
docker run --rm -v plebeian-staging-data:/data -v $(pwd):/backup alpine tar czf /backup/plebeian-staging-backup.tar.gz -C /data .
```

To restore from backup:
```bash
docker run --rm -v plebeian-staging-data:/data -v $(pwd):/backup alpine tar xzf /backup/plebeian-staging-backup.tar.gz -C /data
```

## Environment Variables

The relay is configured with these environment variables (defined in `plebeian-relay.service`):

- `ORLY_LOG_LEVEL=off` - Logging level
- `ORLY_LISTEN=localhost` - Listen address
- `ORLY_PORT=10547` - Port number
- `ORLY_ADMINS=` - Admin users (empty for staging)
- `ORLY_ACL_MODE=none` - Access control mode
- `ORLY_DATA_DIR=/app/docker/staging/data` - Data directory

## Troubleshooting

### Container Won't Start
- Ensure Docker has enough resources (2GB+ RAM)
- Check if ports 3000 and 10547 are available
- Verify the image built successfully: `docker images | grep plebeian-market-staging`

### Web App Not Accessible
- Verify the container is running: `docker ps`
- Check if you started the web app: `docker exec plebeian-market-staging pgrep -f "bun run dev"`
- View web app logs: `docker exec plebeian-market-staging tail -f /app/logs/*` (if log files exist)

### Relay Not Working
- Check relay service status: `docker exec plebeian-market-staging systemctl status plebeian-relay`
- View relay logs: `docker exec plebeian-market-staging journalctl -u plebeian-relay -f`
- Restart relay: `docker exec plebeian-market-staging systemctl restart plebeian-relay`

### Database Issues
- The database is seeded during the Docker build process
- If you need to re-seed: `docker exec plebeian-market-staging bash -c "cd /app && bun run seed"`

### Performance Issues
- Increase Docker memory limits in Docker Desktop/settings
- Check container resource usage: `docker stats plebeian-market-staging`

## Development Notes

- The setup script (`docker-staging-setup.sh`) runs during image build
- The relay code should be available in the `plebeian-orly` directory
- Bun is used as the JavaScript runtime and package manager
- The container uses systemd for service management

## File Structure

```
docker/staging/
├── README.md                    # This file
├── Dockerfile                   # Main Docker image definition
├── docker-staging-setup.sh      # Container setup script
└── plebeian-relay.service       # Systemd service definition
```