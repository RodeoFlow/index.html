// sw.js — Service worker de RodeoFlow (v2)
// Objetivo: que la app ABRA RÁPIDO aunque no haya internet o la señal sea mala (lo típico en el campo).
//
// Antes: pedía todo a la red y esperaba sin límite; con señal mala (conectado pero sin datos reales)
// la app tardaba minutos o no abría, y las librerías externas (Firebase, Excel, PDF, mapas) ni se guardaban.
// Ahora:
//   1) Las librerías externas (con versión fija) se guardan y se sirven desde el celular: no necesitan internet.
//   2) La app y sus archivos: se pide la red, pero si no responde en 3,5 segundos se abre la copia guardada.
// Los datos (animales, potreros, etc.) los maneja la app con IndexedDB; esto NO se mete con eso.

const CACHE_NAME = 'rodeoflow-shell-v2';
const TOPE_RED_MS = 3500;
const ARCHIVOS_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
// Librerías con versión en la dirección: nunca cambian, así que se sirven directo desde la copia guardada.
const LIBRERIAS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try { await cache.addAll(ARCHIVOS_SHELL); } catch (err) { console.warn('[sw] No se pudo guardar todo el shell:', err); }
    // Cada librería por separado: si una falla (sin señal) no se pierde el resto.
    await Promise.all(LIBRERIAS.map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(25000) });
        if (res && res.ok) await cache.put(url, res);
      } catch (e) { /* se reintenta la próxima vez que se abra con internet */ }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Mismo archivo con o sin "?algo": así "precios-mag.json?t=123" y "index.html?v=10" no llenan el celular de copias.
function claveCache(url) { return new Request(url.origin + url.pathname); }

function redConTope(req, url) {
  const clave = claveCache(url);
  return new Promise((resolve) => {
    let respondido = false;
    const desdeCopia = () =>
      caches.match(clave).then((c) => c || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
    const responder = (r) => { if (!respondido) { respondido = true; resolve(r); } };
    // Señal mala: si la red no contesta a tiempo, se abre la copia guardada (la red sigue y actualiza la copia para la próxima).
    const reloj = setTimeout(() => { desdeCopia().then((c) => { if (c) responder(c); }); }, TOPE_RED_MS);
    fetch(req).then((res) => {
      clearTimeout(reloj);
      if (res && res.ok) { const copia = res.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(clave, copia)); }
      responder(res);
    }).catch(() => {
      clearTimeout(reloj);
      desdeCopia().then((c) => responder(c || Response.error()));
    });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Librerías externas con versión fija: primero la copia guardada.
  if (LIBRERIAS.includes(req.url)) {
    event.respondWith(
      caches.match(req.url).then((c) => c || fetch(req).then((res) => {
        if (res && res.ok) { const copia = res.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(req.url, copia)); }
        return res;
      }))
    );
    return;
  }

  // 2) Archivos de la propia app: red con tope de espera y respaldo en la copia guardada.
  if (url.origin === self.location.origin) {
    event.respondWith(redConTope(req, url));
    return;
  }

  // 3) Todo lo demás (Firebase, precios, dólar, etc.) pasa directo a la red.
});
