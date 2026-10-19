// Service worker dos alertas (doc. "public/sw.js"): so recebe Web Push e abre a tela certa ao tocar.
// O texto vem sem valores nem nomes (RN-A03): os detalhes aparecem dentro do app.
/* global self */

const payloadOf = (event) => {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return {};
  }
};

self.addEventListener('push', (event) => {
  const data = payloadOf(event);
  event.waitUntil(
    self.registration.showNotification(data.title || 'Pluto', {
      body: data.body || 'Você tem um aviso. Toque para ver.',
      icon: '/apple-icon.png',
      badge: '/apple-icon.png',
      // Um aviso substitui o anterior em vez de empilhar.
      tag: 'pluto-alerta',
      data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin)) return c.navigate(url).then((w) => (w || c).focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});
