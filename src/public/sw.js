/**
 * Service worker do IFPlenus (PWA).
 * - Páginas e arquivos: tenta a REDE primeiro (sempre a versão mais nova)
 *   e guarda uma cópia; sem internet, usa a cópia.
 * - /api/ NUNCA passa pelo cache (dados pessoais e sempre atualizados).
 * - Sem internet e sem cópia da página → mostra /offline.html.
 * Para forçar todos a baixarem de novo, troque o número da VERSAO.
 */
const VERSAO = 'ifplenus-v5';
const ESSENCIAIS = [
  '/offline.html', '/portal.css', '/portal.js', '/lucide.min.js',
  '/images/logo.svg', '/images/favicon.png', '/images/icon-192.png', '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // fontes do Google etc.: navegador cuida
  if (url.pathname.startsWith('/api/')) return;        // dados: sempre da rede
  if (url.pathname.startsWith('/admin')) return;       // painel admin fica fora do app

  e.respondWith(
    fetch(req)
      .then((resp) => {
        // Só guarda respostas normais (não guarda redirecionamento para o login)
        if (resp.ok && resp.type === 'basic' && !resp.redirected) {
          const copia = resp.clone();
          caches.open(VERSAO).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(async () => {
        const salvo = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
        if (salvo) return salvo;
        if (req.mode === 'navigate') return caches.match('/offline.html');
        return Response.error();
      })
  );
});
