#!/bin/bash

# Start test environment for e2e testing

echo "🚀 Starting test environment..."

# Kill any existing processes on these ports
echo "🧹 Cleaning up existing processes..."
lsof -ti:10547 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Wait a moment for processes to die
sleep 2

# Start relay in background
echo "📡 Starting relay on port 10547..."
nak serve --verbose --port 10547 &
RELAY_PID=$!

# Wait for relay to start
sleep 3

# Start app in background with test environment
echo "🌐 Starting app on port 3000..."
NODE_ENV=test \
APP_RELAY_URL=ws://localhost:10547 \
TEST_APP_PRIVATE_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
bun dev &
APP_PID=$!

# Wait for app to start
sleep 5

echo "✅ Test environment ready!"
echo "📡 Relay PID: $RELAY_PID"
echo "🌐 App PID: $APP_PID"
echo ""
echo "💡 To run tests with visible browser:"
echo "   bun run test:e2e:manual"
echo ""
echo "💡 To run tests with debug mode:"
echo "   bun run test:e2e:manual:debug"
echo ""
echo "🛑 To stop the environment:"
echo "   kill $RELAY_PID $APP_PID"

bun run test:e2e:manual

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