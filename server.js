// VLESS over WebSocket server for Abasthan (Node.js, no framework).
// Listens on process.env.PORT, UUID from process.env.UUID.
// WS path: process.env.WS_PATH (default "/").
// Supports TCP fully; UDP via the VLESS length-prefixed packet format (DNS etc).
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '8080', 10);
const UUID = (process.env.UUID || '').replace(/-/g, '').toLowerCase();
const WS_PATH = process.env.WS_PATH || '/';

if (!UUID || UUID.length !== 32) {
  console.error('UUID env var missing or invalid (expected 32 hex chars, hyphens optional).');
  process.exit(1);
}
const UUID_BUF = Buffer.from(UUID, 'hex');

function parseVlessHeader(buf) {
  // Returns { version, uuid, addonLen, command, port, addrType, addr, addrLen, headerLen }
  // or null if the buffer is too short / malformed.
  if (buf.length < 1 + 16 + 1 + 1 + 2 + 1) return null;
  let off = 0;
  const version = buf[off++];
  const uuid = buf.subarray(off, off + 16); off += 16;
  const addonLen = buf[off++];
  off += addonLen;
  if (off + 1 + 2 + 1 > buf.length) return null;
  const command = buf[off++];
  const port = buf.readUInt16BE(off); off += 2;
  const addrType = buf[off++];
  let addr, addrLen;
  if (addrType === 1) { // IPv4
    if (off + 4 > buf.length) return null;
    addr = Array.from(buf.subarray(off, off + 4)).join('.');
    off += 4;
  } else if (addrType === 2) { // domain
    if (off + 1 > buf.length) return null;
    addrLen = buf[off++];
    if (off + addrLen > buf.length) return null;
    addr = buf.subarray(off, off + addrLen).toString('utf8');
    off += addrLen;
  } else if (addrType === 3) { // IPv6
    if (off + 16 > buf.length) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(off + i).toString(16));
    addr = parts.join(':');
    off += 16;
  } else {
    return null;
  }
  return { version, uuid, addonLen, command, port, addrType, addr, headerLen: off };
}

const server = http.createServer((req, res) => {
  // Plain HTTP health check endpoint.
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Accept the WS path as configured (Abasthan terminates TLS, we see plain WS).
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== WS_PATH && WS_PATH !== '/') {
    // Tolerate any path if WS_PATH is '/', else enforce.
    ws.close(1008, 'bad path');
    return;
  }

  let headerParsed = false;
  let target = null; // net.Socket for TCP
  let udpSocket = null; // dgram.Socket for UDP
  let udpRemote = null; // { addr, port }
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { if (target) target.destroy(); } catch (e) {}
    try { if (udpSocket) udpSocket.close(); } catch (e) {}
    try { ws.close(); } catch (e) {}
  };

  ws.on('message', (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!headerParsed) {
      const h = parseVlessHeader(buf);
      if (!h) { ws.close(1002, 'bad header'); return; }
      if (!h.uuid.equals(UUID_BUF)) { ws.close(1008, 'bad uuid'); return; }
      headerParsed = true;
      // VLESS response header: version 0x00, addon length 0x00.
      ws.send(Buffer.from([0x00, 0x00]));
      const payload = buf.subarray(h.headerLen);
      if (h.command === 1) {
        // TCP
        target = net.connect(h.port, h.addr, () => {
          if (payload.length) target.write(payload);
        });
        target.on('data', (chunk) => {
          if (ws.readyState === 1) ws.send(chunk);
        });
        target.on('error', () => cleanup());
        target.on('close', () => cleanup());
      } else if (h.command === 2) {
        // UDP: each packet is 2-byte big-endian length + payload.
        const dgram = require('dgram');
        udpSocket = dgram.createSocket('udp4');
        udpRemote = { addr: h.addr, port: h.port };
        udpSocket.on('message', (msg) => {
          if (ws.readyState !== 1) return;
          const len = Buffer.alloc(2);
          len.writeUInt16BE(msg.length);
          ws.send(Buffer.concat([len, msg]));
        });
        udpSocket.on('error', () => cleanup());
        if (payload.length) {
          let off = 0;
          while (off + 2 <= payload.length) {
            const len = payload.readUInt16BE(off); off += 2;
            if (off + len > payload.length) break;
            udpSocket.send(payload.subarray(off, off + len), udpRemote.port, udpRemote.addr);
            off += len;
          }
        }
      } else {
        ws.close(1003, 'unsupported command');
      }
      return;
    }
    // After header: relay raw bytes.
    if (target) {
      target.write(buf);
    } else if (udpSocket && udpRemote) {
      let off = 0;
      while (off + 2 <= buf.length) {
        const len = buf.readUInt16BE(off); off += 2;
        if (off + len > buf.length) break;
        udpSocket.send(buf.subarray(off, off + len), udpRemote.port, udpRemote.addr);
        off += len;
      }
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

server.listen(PORT, () => {
  console.log(`vless-ws listening on :${PORT} path=${WS_PATH}`);
});
