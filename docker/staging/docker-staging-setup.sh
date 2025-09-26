#!/bin/bash

set -e  # Exit on any error

echo "🚀 Starting Plebeian Market Docker Staging Setup..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to get Go version
get_go_version() {
    if command_exists go; then
        go version | awk '{print $3}' | sed 's/go//'
    else
        echo ""
    fi
}

# Function to compare version numbers
version_ge() {
    printf '%s\n%s' "$1" "$2" | sort -C -V
}

print_status "Checking system dependencies..."

# Update package list
apt update

# Check and install Git
if ! command_exists git; then
    print_warning "Git not found. Installing Git..."
    apt install -y git
    print_status "Git installed successfully"
else
    print_status "Git is already installed ($(git --version))"
fi

# Install secp256k1 libraries using the next.orly.dev script for fast signature processing
print_status "Downloading and running ubuntu_install_libsecp256k1.sh script..."
cd /tmp
wget -q https://raw.githubusercontent.com/mleku/next.orly.dev/main/scripts/ubuntu_install_libsecp256k1.sh
chmod +x ubuntu_install_libsecp256k1.sh
./ubuntu_install_libsecp256k1.sh
print_status "secp256k1 libraries installed successfully from next.orly.dev script"

# Check and install Go 1.25.1
REQUIRED_GO_VERSION="1.25.1"
CURRENT_GO_VERSION=$(get_go_version)

if [ -z "$CURRENT_GO_VERSION" ]; then
    print_warning "Go not found. Installing Go ${REQUIRED_GO_VERSION}..."
    
    # Download and install Go
    cd /tmp
    wget -q "https://golang.org/dl/go${REQUIRED_GO_VERSION}.linux-amd64.tar.gz"
    
    # Remove existing Go installation if it exists
    rm -rf /usr/local/go
    
    # Install Go
    tar -C /usr/local -xzf "go${REQUIRED_GO_VERSION}.linux-amd64.tar.gz"
    
    # Set PATH for current session
    export PATH=$PATH:/usr/local/go/bin
    
    print_status "Go ${REQUIRED_GO_VERSION} installed successfully"
    
elif ! version_ge "$CURRENT_GO_VERSION" "$REQUIRED_GO_VERSION"; then
    print_warning "Go version ${CURRENT_GO_VERSION} found, but ${REQUIRED_GO_VERSION} or higher is required. Updating..."
    
    # Download and install Go
    cd /tmp
    wget -q "https://golang.org/dl/go${REQUIRED_GO_VERSION}.linux-amd64.tar.gz"
    
    # Remove existing Go installation
    rm -rf /usr/local/go
    
    # Install Go
    tar -C /usr/local -xzf "go${REQUIRED_GO_VERSION}.linux-amd64.tar.gz"
    
    # Set PATH for current session
    export PATH=$PATH:/usr/local/go/bin
    
    print_status "Go updated to ${REQUIRED_GO_VERSION} successfully"
else
    print_status "Go ${CURRENT_GO_VERSION} is already installed (meets requirement >= ${REQUIRED_GO_VERSION})"
fi

# Return to project directory
cd /app

print_status "Setting up relay..."

# Clean up existing plebeian-orly directory
if [ -d "./plebeian-orly" ]; then
    print_warning "Removing existing ./plebeian-orly directory..."
    rm -rf ./plebeian-orly
fi

# Clone or set up the relay (assuming it needs to be cloned)
# Note: The issue mentions using ./plebeian-orly path, but doesn't specify where to get it from
# This might need to be adjusted based on the actual relay repository
if [ ! -d "./plebeian-orly" ]; then
    print_warning "plebeian-orly directory not found. Please ensure the relay code is available at ./plebeian-orly"
    print_warning "Creating placeholder directory for now..."
    git clone https://github.com/mleku/next.orly.dev.git
    mv next.orly.dev plebian-orly
fi

print_status "Installing Bun..."

# Check if Bun is already installed
if ! command_exists bun; then
    print_warning "Bun not found. Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    
    # Add Bun to PATH for current session
    export PATH="$HOME/.bun/bin:$PATH"
    
    print_status "Bun installed successfully"
else
    print_status "Bun is already installed ($(bun --version))"
fi

# Add bun to PATH permanently
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> /root/.bashrc

# Also add bun to system-wide PATH for docker exec sessions
echo 'PATH="$HOME/.bun/bin:$PATH"' >> /etc/environment

# Create a symlink in /usr/local/bin for system-wide access
ln -sf $HOME/.bun/bin/bun /usr/local/bin/bun

print_status "Starting relay in background for seed process..."

# Start the relay in background so the seed script can connect to it
cd ./plebian-orly
ORLY_LOG_LEVEL=off ORLY_LISTEN=localhost ORLY_PORT=10547 ORLY_ADMINS= ORLY_ACL_MODE=none ORLY_DATA_DIR=/tmp/plebeian go run . &
RELAY_PID=$!
print_status "Relay started with PID: ${RELAY_PID}"

# Return to project directory
cd /app

# Wait for relay to be ready (check if it's accepting connections)
print_status "Waiting for relay to be ready..."
for i in {1..30}; do
    if curl -s --connect-timeout 1 http://localhost:10547 >/dev/null 2>&1; then
        print_status "Relay is ready after ${i} seconds"
        break
    fi
    if [ $i -eq 30 ]; then
        print_error "Relay failed to become ready after 30 seconds"
        # Show relay logs for debugging
        jobs -p | xargs -I{} ps -p {} -o pid,cmd || echo "No relay process found"
        exit 1
    fi
    sleep 1
done

print_status "Running database seed..."

# Run the seed command (but don't start the dev server)
print_status "Installing dependencies..."
bun install

print_status "Running startup script..."
bun run startup

print_status "Seeding database..."
bun run seed

# Stop the relay after seeding
print_status "Stopping relay after seeding..."
kill $RELAY_PID 2>/dev/null || echo "Relay process already terminated"

print_status "Setup completed!"
print_status "The relay will be managed by systemd."
print_status "The database has been seeded and is ready for use."
print_status "The web application is ready to run."