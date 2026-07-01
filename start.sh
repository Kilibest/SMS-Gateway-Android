#!/bin/bash
set -e

echo "Starting Android SMS Gateway Dashboard..."
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed."
    echo "Install it from: https://nodejs.org/"
    exit 1
fi

echo "Node.js found: $(node --version)"
echo ""

# Check for required dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

echo "Starting server on port 3000..."
echo "Open browser: http://localhost:3000"
echo "Press Ctrl+C to stop"
echo ""

exec node proxy.js
