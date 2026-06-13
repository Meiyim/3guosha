#!/bin/sh
CONFIG="${1:-config.yaml}"

trap 'kill $SERVER_PID 2>/dev/null; exit 0' INT TERM

node --experimental-transform-types server/index.ts "$CONFIG" &
SERVER_PID=$!
sleep 1

# PIN is printed in server stdout, already visible
echo "Server running (PID $SERVER_PID). Ctrl+C to stop."
echo ""
echo "To join as human:"
echo "  node --experimental-transform-types cli/client.ts --join <PIN> --interactive"
echo ""
echo "To join as AI bot:"
echo "  node --experimental-transform-types bot/ai_bot.ts --join <PIN>"
echo ""

wait $SERVER_PID
