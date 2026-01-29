#!/bin/bash
# =============================================================================
# Plebeian Market - Service Control Script
# =============================================================================
#
# Convenience commands for managing deployed services.
#
# Usage:
#   ./control.sh [stage] <command> [options]
#
# Examples:
#   ./control.sh status                  # Use last deployed stage
#   ./control.sh staging status          # Specific stage
#   ./control.sh production logs 50      # View last 50 lines
#   ./control.sh development ssh         # SSH into dev server
#
# Commands:
#   status       Show status of all services
#   logs [n]     View application logs (last n lines, default 100)
#   logs-relay   View ORLY relay logs (development only)
#   restart      Restart the application
#   stop         Stop the application
#   start        Start the application
#   ssh          SSH into the VPS
#   releases     List deployed releases
#   rollback     Rollback to previous release
#
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -----------------------------------------------------------------------------
# Parse arguments - detect if first arg is a stage or command
# -----------------------------------------------------------------------------
STAGES="development staging production"
COMMANDS="status logs logs-relay restart stop start ssh releases rollback help"

if [[ " $STAGES " =~ " $1 " ]]; then
    STAGE="$1"
    COMMAND="${2:-help}"
    shift 2 2>/dev/null || shift 1
else
    COMMAND="${1:-help}"
    shift 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
# Load saved connection settings
# -----------------------------------------------------------------------------
if [[ -n "$STAGE" ]] && [[ -f "$SCRIPT_DIR/.env.deploy.$STAGE" ]]; then
    source "$SCRIPT_DIR/.env.deploy.$STAGE"
elif [[ -f "$SCRIPT_DIR/.env.deploy" ]]; then
    source "$SCRIPT_DIR/.env.deploy"
else
    echo "⚠ No deployment found. Run ./deploy.sh first."
    STAGE="${STAGE:-development}"
fi

# Defaults
STAGE="${STAGE:-development}"
SSH_HOST="${SSH_HOST:-localhost}"
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-deployer}"
SSH_PASSWORD="${SSH_PASSWORD:-deployer}"
PM2_APP_NAME="${PM2_APP_NAME:-market-$STAGE}"
REMOTE_BASE="/home/$SSH_USER"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-$REMOTE_BASE/market-$STAGE}"

# -----------------------------------------------------------------------------
# SSH setup
# -----------------------------------------------------------------------------
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
if [[ -n "$SSH_KEY" ]]; then
    SSH_CMD="ssh $SSH_OPTS -i $SSH_KEY -p $SSH_PORT $SSH_USER@$SSH_HOST"
elif [[ -n "$SSH_PASSWORD" ]]; then
    SSH_CMD="sshpass -p $SSH_PASSWORD ssh $SSH_OPTS -p $SSH_PORT $SSH_USER@$SSH_HOST"
else
    SSH_CMD="ssh $SSH_OPTS -p $SSH_PORT $SSH_USER@$SSH_HOST"
fi

run_ssh() { $SSH_CMD "$@"; }
run_ssh_bun() { $SSH_CMD "export PATH=\"\$HOME/.bun/bin:\$PATH\" && $*"; }

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------
case "$COMMAND" in
    status)
        echo "📊 Service Status ($STAGE)"
        echo "═════════════════════════════════════════════════════════════════"
        echo ""
        echo "Target: $SSH_USER@$SSH_HOST:$SSH_PORT"
        echo "PM2 App: $PM2_APP_NAME"
        echo ""
        echo "PM2 Processes:"
        run_ssh "pm2 ls"
        echo ""
        echo "Current Release:"
        run_ssh "readlink $REMOTE_APP_DIR 2>/dev/null | xargs basename || echo '  Not deployed'"
        if [[ "$STAGE" == "development" ]]; then
            echo ""
            echo "ORLY Relay:"
            if run_ssh "pgrep -x orly > /dev/null" 2>/dev/null; then
                echo "  ✓ Running (PID: $(run_ssh 'pgrep -x orly'))"
            else
                echo "  ✗ Not running"
            fi
        fi
        ;;

    logs)
        LINES="${1:-100}"
        echo "📜 Application Logs - $STAGE (last $LINES lines)"
        echo "═════════════════════════════════════════════════════════════════"
        run_ssh "pm2 logs $PM2_APP_NAME --lines $LINES --nostream" || true
        ;;

    logs-relay)
        if [[ "$STAGE" != "development" ]]; then
            echo "⚠ ORLY relay logs only available in development stage"
            exit 1
        fi
        echo "📜 ORLY Relay Logs (Ctrl+C to exit)"
        echo "═════════════════════════════════════════════════════════════════"
        run_ssh "tail -f $REMOTE_BASE/logs/orly.log"
        ;;

    restart)
        echo "🔄 Restarting $PM2_APP_NAME..."
        run_ssh "pm2 restart $PM2_APP_NAME"
        echo "✓ Application restarted"
        ;;

    stop)
        echo "⏹️  Stopping $PM2_APP_NAME..."
        run_ssh "pm2 stop $PM2_APP_NAME"
        echo "✓ Application stopped"
        ;;

    start)
        echo "▶️  Starting $PM2_APP_NAME..."
        run_ssh_bun "cd $REMOTE_APP_DIR && pm2 start ecosystem.config.cjs --only $PM2_APP_NAME"
        run_ssh "pm2 save --force"
        echo "✓ Application started"
        ;;

    ssh)
        echo "🔗 Connecting to $STAGE VPS..."
        $SSH_CMD
        ;;

    releases)
        echo "📦 Deployed Releases ($STAGE)"
        echo "═════════════════════════════════════════════════════════════════"
        CURRENT=$(run_ssh "readlink $REMOTE_APP_DIR 2>/dev/null | xargs basename || echo ''")
        run_ssh "ls -lt $REMOTE_BASE/releases | grep 'market-$STAGE'" 2>/dev/null | while read line; do
            if [[ "$line" == *"$CURRENT"* ]] && [[ -n "$CURRENT" ]]; then
                echo "  $line  ← current"
            else
                echo "  $line"
            fi
        done
        ;;

    rollback)
        echo "⏪ Rolling back $STAGE to previous release..."
        CURRENT=$(run_ssh "readlink $REMOTE_APP_DIR | xargs basename")
        PREVIOUS=$(run_ssh "ls -t $REMOTE_BASE/releases | grep '^market-$STAGE' | grep -v '$CURRENT' | head -1")
        
        if [[ -z "$PREVIOUS" ]]; then
            echo "✗ No previous release found"
            exit 1
        fi
        
        echo "  Current:  $CURRENT"
        echo "  Rollback: $PREVIOUS"
        echo ""
        read -p "Proceed? [y/N] " -n 1 -r
        echo
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            run_ssh "pm2 stop $PM2_APP_NAME 2>/dev/null || true"
            run_ssh "ln -sfn $REMOTE_BASE/releases/$PREVIOUS $REMOTE_APP_DIR"
            run_ssh_bun "cd $REMOTE_APP_DIR && pm2 start ecosystem.config.cjs --only $PM2_APP_NAME"
            run_ssh "pm2 save --force"
            echo "✓ Rolled back to $PREVIOUS"
        else
            echo "Cancelled"
        fi
        ;;

    help|--help|-h|*)
        echo ""
        echo "Plebeian Market - Service Control"
        echo ""
        echo "Usage: ./control.sh [stage] <command>"
        echo ""
        echo "Stages:"
        echo "  development    Local development server"
        echo "  staging        Staging server"
        echo "  production     Production server"
        echo ""
        echo "Commands:"
        echo "  status         Show status of all services"
        echo "  logs [n]       View last n app log lines (default: 100)"
        echo "  logs-relay     View ORLY relay logs (development only)"
        echo "  restart        Restart the application"
        echo "  stop           Stop the application"
        echo "  start          Start the application"
        echo "  ssh            SSH into the VPS"
        echo "  releases       List deployed releases"
        echo "  rollback       Rollback to previous release"
        echo ""
        echo "Current configuration:"
        echo "  Stage:    $STAGE"
        echo "  Host:     $SSH_HOST:$SSH_PORT"
        echo "  User:     $SSH_USER"
        echo "  PM2 App:  $PM2_APP_NAME"
        echo ""
        ;;
esac
