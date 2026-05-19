#!/bin/bash

# Start test environment for e2e testing

echo "🚀 Starting test environment..."

# Kill any existing processes on these ports
echo "🧹 Cleaning up existing processes..."
lsof -ti:10547 | xargs kill -9 2>/dev/null || true
lsof -ti:34567 | xargs kill -9 2>/dev/null || true

# Wait a moment for processes to die
sleep 2

# Start relay in background
echo "📡 Starting relay on port 10547..."
nak serve --port 10547 &
RELAY_PID=$!

# Wait for relay to start
sleep 3

# Seed relay before app startup because the app caches settings at startup
echo "🌱 Seeding relay..."
bun e2e/seed-relay.ts

# Start app in background with test environment
echo "🌐 Starting app on port 34567..."
NODE_ENV=test \
PORT=34567 \
APP_RELAY_URL=ws://localhost:10547 \
APP_PRIVATE_KEY=e2e0000000000000000000000000000000000000000000000000000000000001 \
LOCAL_RELAY_ONLY=true \
NIP46_RELAY_URL=ws://localhost:10547 \
bun dev &
APP_PID=$!

# Wait for app to start
sleep 5

echo "✅ Test environment ready!"
echo "📡 Relay PID: $RELAY_PID"
echo "🌐 App PID: $APP_PID"
echo ""
echo "💡 To run tests with visible browser:"
echo "   bun run test:e2e -- --headed"
echo ""
echo "💡 To run tests with debug mode:"
echo "   bun run test:e2e:debug"
echo ""
echo "🛑 To stop the environment:"
echo "   kill $RELAY_PID $APP_PID"

bun run test:e2e -- --headed

# Keep script running and handle cleanup on exit
cleanup() {
    echo "🧹 Cleaning up test environment..."
    kill $RELAY_PID $APP_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for user to stop
echo "Press Ctrl+C to stop the test environment..."
wait 