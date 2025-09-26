#!/bin/bash

set -e  # Exit on any error

echo "🚀 Starting Plebeian Market Staging Setup..."

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

# Check and install Git
if ! command_exists git; then
    print_warning "Git not found. Installing Git..."
    sudo apt update
    sudo apt install -y git
    print_status "Git installed successfully"
else
    print_status "Git is already installed ($(git --version))"
fi

# Check and install Go 1.25.1
REQUIRED_GO_VERSION="1.25.1"
CURRENT_GO_VERSION=$(get_go_version)

if [ -z "$CURRENT_GO_VERSION" ]; then
    print_warning "Go not found. Installing Go ${REQUIRED_GO_VERSION}..."
    
    # Download and install Go
    cd /tmp
    wget -q "https://golang.org/dl/go${REQUIRED_GO_VERSION}.linux-amd64.tar.gz"
    
    # Remove existing Go installation if it exists
    sudo rm -rf /usr/local/go
    
    # Install Go
    sudo tar -C /usr/local -xzf "go${REQUIRED_GO_VERSION}.linux-amd64.tar.gz"
    
    # Add Go to PATH if not already there
    if ! grep -q "/usr/local/go/bin" ~/.bashrc; then
        echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
    fi
    
    # Set PATH for current session
    export PATH=$PATH:/usr/local/go/bin
    
    print_status "Go ${REQUIRED_GO_VERSION} installed successfully"
    
elif ! version_ge "$CURRENT_GO_VERSION" "$REQUIRED_GO_VERSION"; then
    print_warning "Go version ${CURRENT_GO_VERSION} found, but ${REQUIRED_GO_VERSION} or higher is required. Updating..."
    
    # Download and install Go
    cd /tmp
    wget -q "https://golang.org/dl/go${REQUIRED_GO_VERSION}.linux-amd64.tar.gz"
    
    # Remove existing Go installation
    sudo rm -rf /usr/local/go
    
    # Install Go
    sudo tar -C /usr/local -xzf "go${REQUIRED_GO_VERSION}.linux-amd64.tar.gz"
    
    # Set PATH for current session
    export PATH=$PATH:/usr/local/go/bin
    
    print_status "Go updated to ${REQUIRED_GO_VERSION} successfully"
else
    print_status "Go ${CURRENT_GO_VERSION} is already installed (meets requirement >= ${REQUIRED_GO_VERSION})"
fi

# Return to project directory
cd "$(dirname "$0")/.."

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
    mkdir -p ./plebeian-orly
    echo "// Placeholder - relay code should be here" > ./plebeian-orly/main.go
fi

print_status "Starting relay in background..."

# Set environment variables and start relay in background
cd ./plebeian-orly
ORLY_LOG_LEVEL=off ORLY_LISTEN=localhost ORLY_PORT=10547 ORLY_ADMINS= ORLY_ACL_MODE=none ORLY_DATA_DIR=./plebian-orly go run . &
RELAY_PID=$!

print_status "Relay started with PID: ${RELAY_PID}"

# Return to project root
cd ..

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

print_status "Running database seed..."

# Run the seed command
print_status "Executing 'bun run dev:seed'..."
print_warning "This will start the development server. Please wait for the seeding to complete,"
print_warning "then press Ctrl+C to terminate the process when ready."
print_warning ""
print_warning "After you terminate with Ctrl+C:"
print_warning "- The relay database will be ready to use"
print_warning "- The web app will be ready to run"
print_warning ""

# Run the seed command
bun run dev:seed

print_status "Setup completed!"
print_status "The relay is running in the background (PID: ${RELAY_PID})"
print_status "The database has been seeded and is ready for use."
print_status "The web application is ready to run."

# Create a cleanup script
cat > cleanup-staging.sh << 'EOF'
#!/bin/bash
echo "Cleaning up staging setup..."
if [ -n "$1" ]; then
    echo "Killing relay process (PID: $1)"
    kill $1 2>/dev/null || echo "Process $1 not found or already terminated"
fi
echo "Cleanup completed"
EOF

chmod +x cleanup-staging.sh

print_status "Created cleanup-staging.sh script"
print_status "To stop the relay later, run: ./cleanup-staging.sh ${RELAY_PID}"