import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

// Logos oficiais que o usuario colocou em public/logos (<marca>.svg|png|webp). Lidos ao iniciar o
// next dev/build: arquivo novo pede reiniciar. Vao para o app como lista (sem 404 por logo ausente).
const logosDir = join(process.cwd(), 'public', 'logos');
const localLogos = existsSync(logosDir) ? readdirSync(logosDir).filter((f) => /^[a-z0-9-]+\.(svg|png|webp)$/i.test(f)) : [];

// Secao 3.6: mobile usa build estatico exportado para o Capacitor.
const isMobile = process.env.BUILD_TARGET === 'mobile';

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

// Web: o navegador chama /v1 no proprio site e o Next repassa para a API. Mesma origem,
// entao o cookie do refresh (SameSite=Strict) funciona sem CORS. O app mobile chama a API direto.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3333';

const config: NextConfig = {
  output: isMobile ? 'export' : undefined,
  images: { unoptimized: isMobile },
  trailingSlash: isMobile,
  reactStrictMode: true,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_LOCAL_LOGOS: localLogos.join(',') },
  transpilePackages: ['@pluto/shared', '@pluto/finance-engine'],
  // headers() nao se aplica ao export estatico.
  ...(isMobile
    ? {}
    : {
        headers: async () => [{ source: '/:path*', headers: securityHeaders }],
        rewrites: async () => [{ source: '/v1/:path*', destination: `${API_TARGET}/v1/:path*` }],
      }),
};

export default config;
