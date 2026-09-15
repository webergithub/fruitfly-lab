// 本地预览用的静态服务器（不部署）：node fly-aim/tools/serve.mjs 8765
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 可选第二个参数：要服务的目录（默认 fly-aim/）
const root = process.argv[3] ? path.resolve(process.argv[3]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8765;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(port, () => console.log(`fly-aim preview on http://localhost:${port}`));
