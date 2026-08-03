/**
 * serve.mjs — 极简静态文件服务器（无第三方依赖，仅用 node:http / node:fs）
 *
 * 用于浏览器开发预览：先 `npm run build:web`（产出 dist/），再 `npm run dev` 启动本服务。
 * 默认端口 8080，可用 PORT 环境变量覆盖。
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const root = resolve(process.cwd());
const port = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const safe = normalize(join(root, p));
    if (!safe.startsWith(root) || !existsSync(safe)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not found');
      return;
    }
    const data = await readFile(safe);
    res.writeHead(200, { 'content-type': MIME[extname(safe)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 Server error');
  }
}).listen(port, () => {
  console.log(`[serve] http://localhost:${port}  (serving ${root})`);
});
