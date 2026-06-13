# 三国杀 Online - Project Notes

## Transport
This project uses WebSocket exclusively for client-server communication. Do NOT add HTTP polling fallback or suggest switching to HTTP. All clients (browser, CLI, bot, tests) use WebSocket.
