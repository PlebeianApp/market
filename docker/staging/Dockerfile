FROM ubuntu:22.04

# Install systemd and other required packages
RUN apt-get update && \
    apt-get install -y \
    systemd \
    systemd-sysv \
    sudo \
    wget \
    curl \
    ca-certificates \
    gzip \
    unzip \
    build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Remove unnecessary systemd services for container
RUN find /etc/systemd/system \
    /lib/systemd/system \
    -path '*.wants/*' \
    \( -name '*getty*' -o -name '*systemd-logind*' -o -name '*systemd-vconsole-setup*' -o -name '*systemd-readahead*' -o -name '*udev*' \) \
    -exec rm \{} \; && \
    systemctl set-default multi-user.target

# Create app directory
WORKDIR /app

# Copy the entire project
COPY . /app/

# Make staging setup script executable
RUN chmod +x /app/scripts/staging-setup.sh

# Create data directory for relay database
RUN mkdir -p /tmp/plebeian

# Create orly repo mount point
RUN mkdir -p /app/orly

# Create systemd service file for the relay
COPY docker/staging/plebeian-relay.service /etc/systemd/system/plebeian-relay.service

# Create modified staging setup script
COPY docker/staging/docker-staging-setup.sh /app/scripts/docker-staging-setup.sh
RUN chmod +x /app/scripts/docker-staging-setup.sh

# Run the setup script
RUN /app/scripts/docker-staging-setup.sh

# Enable the relay service (systemctl enable only, --now doesn't work during build)
RUN systemctl enable plebeian-relay.service

# Create volume mount points
VOLUME ["/tmp/plebeian", "/app/orly"]

# Expose the relay port and web app port
EXPOSE 10547 3000

# Start systemd
CMD ["/lib/systemd/systemd"]