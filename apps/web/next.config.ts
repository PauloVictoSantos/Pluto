import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

// Logos oficiais que o usuario colocou em public/icon ou public/logos (<marca>.png, Amazon.png...).
// Lidos ao iniciar o next dev/build: arquivo novo pede reiniciar. Vao para o app como lista de caminhos
// (sem 404 por logo ausente).
const localLogos = ['icon', 'logos'].flatMap((dir) => {
  const full = join(process.cwd(), 'public', dir);
  return existsSync(full) ? readdirSync(full).filter((f) => /^[a-z0-9-]+\.(svg|png|webp|jpe?g)$/i.test(f)).map((f) => `${dir}/${f}`) : [];
});

// Secao 6.7. O site so carrega recursos proprios (fontes via next/font, logos em /public, API em /v1).
// 'unsafe-inline' em script-src: as paginas sao estaticas e o Next injeta scripts inline sem nonce;
// ainda assim nenhum script de outro dominio roda. Em dev o Next precisa de eval (HMR).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${process.env.NODE_ENV === 'production' ? '' : ' ws:'}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

// O navegador chama /v1 no proprio site e o Next repassa para a API. Mesma origem,
// entao o cookie do refresh (SameSite=Strict) funciona sem CORS.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3333';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_LOCAL_LOGOS: localLogos.join(',') },
  transpilePackages: ['@pluto/shared', '@pluto/finance-engine'],
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
  rewrites: async () => [{ source: '/v1/:path*', destination: `${API_TARGET}/v1/:path*` }],
};

export default config;
