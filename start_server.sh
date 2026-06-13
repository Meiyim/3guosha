#!/bin/sh
PORT=3000
VERBOSE=1
LOG_DIR=./logs
OPEN_ROOM=""

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2;;
    --quiet) VERBOSE=0; shift;;
    --log-dir) LOG_DIR="$2"; shift 2;;
    --no-log) LOG_DIR=""; shift;;
    --open-room) OPEN_ROOM="$2"; shift 2;;
    --help) echo "Usage: ./start_server.sh [options]"
            echo "  --port NUM       Server port (default: 3000)"
            echo "  --quiet          Disable verbose output"
            echo "  --log-dir DIR    Log directory (default: ./logs)"
            echo "  --no-log         Disable file logging"
            echo "  --open-room NAME Create a room on start, print PIN"
            exit 0;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

export PORT VERBOSE LOG_DIR
node --experimental-strip-types server/index.ts &
SERVER_PID=$!
sleep 1

if [ -n "$OPEN_ROOM" ]; then
  HOST_IP=$(hostname -I | awk '{print $1}')
  RESP=$(curl -s -X POST "http://localhost:$PORT/api/action" -H 'Content-Type: application/json' -d "{\"type\":\"connect\"}")
  TOKEN=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")
  curl -s -X POST "http://localhost:$PORT/api/action" -H 'Content-Type: application/json' -d "{\"type\":\"create_room\",\"name\":\"$OPEN_ROOM\",\"token\":\"$TOKEN\"}" > /dev/null
  PIN=$(curl -s "http://localhost:$PORT/api/poll?token=$TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).messages.find(m=>m.type==='room_created').pin))")
  echo ""
  echo "========================================="
  echo "  Room ready!  PIN: $PIN"
  echo "  Join at: http://$HOST_IP:$PORT"
  echo "========================================="
  echo ""
fi

wait $SERVER_PID
