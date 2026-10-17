import type { NextConfig } from 'next';

// Secao 3.6: mobile usa build estatico exportado para o Capacitor.
const isMobile = process.env.BUILD_TARGET === 'mobile';

// Secao 6.7. A CSP com nonce sera adicionada via middleware junto com a autenticacao.
const securityHeaders = [
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
