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
    : { headers: async () => [{ source: '/:path*', headers: securityHeaders }] }),
};

export default config;
