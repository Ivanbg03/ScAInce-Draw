import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const serverDir = join(dist, 'server');

const servedRoots = ['index.html', 'gallery.html', 'styles.css', 'src'];
const ignoredNames = new Set(['.git', '.openai', 'dist', 'node_modules', 'scripts', 'test']);

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function collect(path, out = []) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await collect(child, out);
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
  return out;
}

const files = [];
for (const item of servedRoots) {
  const path = join(root, item);
  if (!(await exists(path))) continue;
  try {
    const nested = await collect(path);
    files.push(...nested);
  } catch {
    files.push(path);
  }
}

const assets = [];
for (const file of files) {
  const route = '/' + relative(root, file).split(sep).join('/');
  const body = await readFile(file, extname(file).match(/\.(png|jpe?g|webp)$/i) ? undefined : 'utf8');
  const binary = Buffer.isBuffer(body);
  assets.push({
    route,
    mimeType: mimeTypes.get(extname(file).toLowerCase()) || 'application/octet-stream',
    body: binary ? body.toString('base64') : body,
    base64: binary,
  });
}

const worker = `const assets = new Map(${JSON.stringify(assets, null, 2)}.map((asset) => [asset.route, asset]));

const cacheHeaders = {
  'Cache-Control': 'public, max-age=60',
  'X-Content-Type-Options': 'nosniff',
};

function assetResponse(asset) {
  const body = asset.base64
    ? Uint8Array.from(atob(asset.body), (char) => char.charCodeAt(0))
    : asset.body;
  return new Response(body, {
    headers: {
      ...cacheHeaders,
      'Content-Type': asset.mimeType,
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname;
    if (path === '/') path = '/index.html';
    const asset = assets.get(path);
    if (asset) return assetResponse(asset);
    if (!path.includes('.') && assets.has('/index.html')) {
      return assetResponse(assets.get('/index.html'));
    }
    return new Response('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
};
`;

await rm(dist, { recursive: true, force: true });
await mkdir(serverDir, { recursive: true });
await writeFile(join(serverDir, 'index.js'), worker, 'utf8');
console.log(`Built ${assets.length} editor assets into dist/server/index.js`);
