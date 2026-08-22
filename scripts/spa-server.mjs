// Simple SPA server for testing built files
import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';

const ROOT = 'dist/public';
const PORT = 4173;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const server = createServer(async (req, res) => {
  let path = req.url?.split('?')[0] || '/';
  if (path === '/') path = '/index.html';
  const filePath = join(ROOT, path);
  try {
    const s = await stat(filePath);
    if (s.isFile()) {
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
      res.end(data);
      return;
    }
  } catch {}
  // SPA fallback
  try {
    const index = await readFile(join(ROOT, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(index);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => console.log(`SPA server on http://localhost:${PORT}`));
