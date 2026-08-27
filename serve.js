const http = require('http');
const fs = require('fs');
const path = require('path');

const types = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html' };

http.createServer((request, response) => {
  const requested = request.url === '/' ? 'index.html' : request.url.slice(1);
  const file = path.join(__dirname, requested);
  fs.readFile(file, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(content);
  });
}).listen(4173, () => console.log('BeeCX available at http://127.0.0.1:4173'));
