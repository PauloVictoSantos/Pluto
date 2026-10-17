import type { CapacitorConfig } from '@capacitor/cli';

// Secao 8.1. Em debug, server.url pode apontar para o dev server; nunca em release.
const devServerUrl = process.env.CAP_DEV_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'br.pessoal.pluto',
  appName: 'Pluto',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    cleartext: false,
    ...(devServerUrl ? { url: devServerUrl } : {}),
  },
  android: {
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
