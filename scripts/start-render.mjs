// Producao no Render: um unico servico com a API e o site.
// - API em 127.0.0.1:3333, invisivel de fora (so o Next fala com ela, pelo rewrite /v1).
// - Site (next start) em 0.0.0.0:$PORT, atras do proxy HTTPS do Render.
// Se um dos dois cair, o outro e encerrado e o Render reinicia o servico.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = join(root, 'apps', 'web');
const nextBin = createRequire(join(webDir, 'package.json')).resolve('next/dist/bin/next');
// Tem de bater com o destino do rewrite /v1, que o Next grava no build (API_PROXY_TARGET,
// padrao http://127.0.0.1:3333). API_INTERNAL_PORT so serve para testar localmente com outro build.
const API_PORT = process.env.API_INTERNAL_PORT ?? '3333';

const children = [];
let stopping = false;

function run(name, args, opts) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', ...opts });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[start] ${name} saiu (${signal ?? code}); encerrando o servico`);
    stop(code ?? 1);
  });
  return child;
}

function stop(code) {
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 8000).unref();
  Promise.all(children.map((c) => (c.exitCode === null ? new Promise((r) => c.once('exit', r)) : null))).then(() => process.exit(code));
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

// A API le a configuracao do ambiente do Render (nao ha .env em producao).
// PORT do Render e do site; a API usa a sua propria porta interna.
run('api', [join(root, 'apps', 'api', 'dist', 'server.js')], {
  cwd: join(root, 'apps', 'api'),
  env: { ...process.env, HOST: '127.0.0.1', PORT: API_PORT },
});

run('web', [nextBin, 'start', '-H', '0.0.0.0', '-p', process.env.PORT ?? '3000'], { cwd: webDir });
