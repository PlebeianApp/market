#!/bin/bash
# PM2 Remote Control Script
# Control PM2 processes on the VPS via SSH
#
# Usage:
#   ./pm2-control.sh [command] [args...]
#
# Commands:
#   ls              - List all PM2 processes
#   logs [lines]    - View logs (default: 100 lines)
#   restart         - Restart the app
#   reload          - Zero-downtime reload
#   stop            - Stop the app
#   start           - Start the app
#   monit           - Real-time monitoring
#   status          - Show detailed status
#   env             - Show environment variables
#
# Examples:
#   ./pm2-control.sh ls
#   ./pm2-control.sh logs 50
#   ./pm2-control.sh restart
#   ./pm2-control.sh reload

set -e

# Configuration
SSH_HOST="${SSH_HOST:-localhost:2222}"
SSH_USER="${SSH_USER:-deployer}"
SSH_PASSWORD="${SSH_PASSWORD:-deployer}"
APP_NAME="market-staging"

# Parse host and port
if [[ "$SSH_HOST" == *":"* ]]; then
    HOST="${SSH_HOST%:*}"
    PORT="${SSH_HOST#*:}"
else
    HOST="$SSH_HOST"
    PORT="22"
fi

COMMAND="${1:-ls}"
ARGS="${@:2}"

# Function to run commands via SSH
run_ssh() {
    sshpass -p "$SSH_PASSWORD" ssh -o StrictHostKeyChecking=no -p "$PORT" "$SSH_USER@$HOST" "source ~/.bashrc && $@"
}

run_ssh_tty() {
    sshpass -p "$SSH_PASSWORD" ssh -t -o StrictHostKeyChecking=no -p "$PORT" "$SSH_USER@$HOST" "source ~/.bashrc && $@"
}

echo "🔧 PM2 Control: $COMMAND"
echo "   Host: $HOST:$PORT"
echo "   App: $APP_NAME"
echo ""

case $COMMAND in
    ls|list)
        run_ssh "pm2 ls"
        ;;
    
    logs|log)
        LINES="${ARGS:-100}"
        run_ssh_tty "pm2 logs $APP_NAME --lines $LINES"
        ;;
    
    restart)
        run_ssh "pm2 restart $APP_NAME && pm2 ls"
        ;;
    
    reload)
        run_ssh "pm2 reload $APP_NAME && pm2 ls"
        ;;
    
    stop)
        run_ssh "pm2 stop $APP_NAME && pm2 ls"
        ;;
    
    start)
        run_ssh "pm2 start $APP_NAME && pm2 ls"
        ;;
    
    monit|monitor)
        run_ssh_tty "pm2 monit"
        ;;
    
    status|info)
        run_ssh "pm2 describe $APP_NAME"
        ;;
    
    env|environment)
        run_ssh "pm2 env $APP_NAME 2>/dev/null || echo 'Getting env from describe...' && pm2 describe $APP_NAME | grep -A 50 'env:' | head -30"
        ;;
    
    save)
        run_ssh "pm2 save"
        ;;
    
    *)
        echo "Unknown command: $COMMAND"
        echo ""
        echo "Available commands:"
        echo "  ls              - List all PM2 processes"
        echo "  logs [lines]    - View logs (default: 100 lines)"
        echo "  restart         - Restart the app"
        echo "  reload          - Zero-downtime reload"
        echo "  stop            - Stop the app"
        echo "  start           - Start the app"
        echo "  monit           - Real-time monitoring"
        echo "  status          - Show detailed status"
        echo "  env             - Show environment variables"
        exit 1
        ;;
esac

echo ""
echo "✅ Command completed"
