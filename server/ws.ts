import * as http from 'http';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

export class MinimalWebSocketServer extends EventEmitter {
  constructor(server) {
    super();
    server.on('upgrade', (req, socket, head) => {
      const key = req.headers['sec-websocket-key'];
      if (!key) { socket.destroy(); return; }
      const accept = crypto.createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-5AB9DC62C5B2')
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      const ws = new MinimalWebSocket(socket);
      this.emit('connection', ws);
    });
  }
}

export class MinimalWebSocket extends EventEmitter {
  #socket;
  #buffer = Buffer.alloc(0);

  constructor(socket) {
    super();
    this.#socket = socket;
    socket.on('data', (data) => {
      this.#buffer = Buffer.concat([this.#buffer, data]);
      this.#processFrames();
    });
    socket.on('close', () => this.emit('close'));
    socket.on('error', () => this.emit('close'));
  }

  get readyState() { return this.#socket.writable ? 1 : 3; }

  send(data) {
    if (!this.#socket.writable) return;
    const payload = Buffer.from(data, 'utf8');
    this.#socket.write(this.#buildFrame(1, payload));
  }

  close() {
    try {
      this.#socket.write(this.#buildFrame(8, Buffer.alloc(0)));
      this.#socket.end();
    } catch {}
  }

  #processFrames() {
    while (this.#buffer.length >= 2) {
      const firstByte = this.#buffer[0];
      const secondByte = this.#buffer[1];
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.#buffer.length < 4) return;
        payloadLen = this.#buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.#buffer.length < 10) return;
        payloadLen = Number(this.#buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskSize = masked ? 4 : 0;
      const totalLen = offset + maskSize + payloadLen;
      if (this.#buffer.length < totalLen) return;

      let payload = this.#buffer.subarray(offset + maskSize, totalLen);
      if (masked) {
        const mask = this.#buffer.subarray(offset, offset + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      this.#buffer = this.#buffer.subarray(totalLen);

      if (opcode === 1) this.emit('message', payload.toString('utf8'));
      else if (opcode === 8) { this.emit('close'); this.#socket.end(); }
      else if (opcode === 9) this.#socket.write(this.#buildFrame(10, payload));
    }
  }

  #buildFrame(opcode, payload) {
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = payload.length;
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    return Buffer.concat([header, payload]);
  }
}
