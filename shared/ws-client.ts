// Shared WebSocket client for Node.js — used by tests and bot
import * as http from 'http';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

export class WsClient extends EventEmitter {
  private socket: any = null;
  private buffer = Buffer.alloc(0);

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        host, port, path: '/', method: 'GET',
        headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' }
      });
      req.on('upgrade', (_res: any, socket: any) => {
        this.socket = socket;
        socket.on('data', (data: Buffer) => {
          this.buffer = Buffer.concat([this.buffer, data]);
          this.processFrames();
        });
        socket.on('close', () => this.emit('close'));
        socket.on('error', () => this.emit('close'));
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  }

  send(obj: any): void {
    if (!this.socket) return;
    const payload = Buffer.from(JSON.stringify(obj));
    const mask = crypto.randomBytes(4);
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x81; header[1] = 0x80 | payload.length;
      mask.copy(header, 2);
    } else {
      header = Buffer.alloc(8);
      header[0] = 0x81; header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    }
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, masked]));
  }

  close(): void {
    if (this.socket) { this.socket.destroy(); this.socket = null; }
  }

  private processFrames(): void {
    while (this.buffer.length >= 2) {
      const secondByte = this.buffer[1];
      let payloadLen = secondByte & 0x7f;
      let offset = 2;
      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + payloadLen) return;
      const payload = this.buffer.subarray(offset, offset + payloadLen).toString();
      this.buffer = this.buffer.subarray(offset + payloadLen);
      try { this.emit('message', JSON.parse(payload)); } catch {}
    }
  }
}

// Helper: connect and collect messages
export function createWsPlayer(host: string, port: number): Promise<{ ws: WsClient; messages: any[]; send: (obj: any) => void; waitFor: (type: string, timeout?: number) => Promise<any>; drain: () => any[] }> {
  return new Promise(async (resolve) => {
    const ws = new WsClient();
    const messages: any[] = [];
    ws.on('message', (msg: any) => messages.push(msg));
    await ws.connect(host, port);
    resolve({
      ws,
      messages,
      send: (obj: any) => ws.send(obj),
      waitFor: (type: string, timeout = 3000) => new Promise((res, rej) => {
        const existing = messages.find(m => m.type === type);
        if (existing) { messages.splice(messages.indexOf(existing), 1); res(existing); return; }
        const check = setInterval(() => {
          const found = messages.find(m => m.type === type);
          if (found) { clearInterval(check); clearTimeout(t); messages.splice(messages.indexOf(found), 1); res(found); }
        }, 20);
        const t = setTimeout(() => { clearInterval(check); rej(new Error(`timeout waiting for ${type}`)); }, timeout);
      }),
      drain: () => messages.splice(0),
    });
  });
}
