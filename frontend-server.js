const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.resolve(__dirname);
const port = Number(process.env.FRONTEND_PORT || 5500);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const relativePath = requestPath === '/' ? 'frontend/index.html' : requestPath.replace(/^\/+/, '');
    const filePath = path.resolve(root, relativePath);
    if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) return send(res, 403, 'Forbidden');

    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) return send(res, 404, 'Not found');
      const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (error) {
    send(res, 400, 'Invalid request');
  }
});

server.listen(port, () => {
  console.log(`[frontend] Play-is-School frontend running at http://localhost:${port}`);
});
