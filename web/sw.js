// ============================================================
// sw.js — service worker
// ============================================================
// Existe por dois motivos, nesta ordem:
//   1. sem ele o Chrome não oferece "Instalar app" no Windows;
//   2. com ele, o app abre mesmo sem internet — e avisa, em vez de dar a
//      tela de dinossauro do navegador.
//
// Estratégia: rede primeiro, cache como rede de segurança. O contrário
// (cache primeiro) é mais rápido, mas serviria uma versão velha do app depois
// de cada deploy — e aqui o app conversa com uma API que evolui junto.
//
// O que NUNCA passa por aqui: qualquer pedido para outro domínio. As chamadas
// à API (saldo, lançamentos, sessão) seguem diretas para a rede; guardar
// resposta de API em cache mostraria saldo velho como se fosse o de agora.
// ============================================================

var CACHE = "gestor-v1";
var CASCA = ["/", "/index.html", "/config.js", "/manifest.webmanifest",
  "/icons/icone-192.png", "/icons/icone-512.png", "/icons/icone-maskable-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CASCA); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  // Some com os caches de versões anteriores; senão eles ficam ocupando espaço
  // do aparelho para sempre.
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return; // a API não passa por aqui
  e.respondWith(
    fetch(req)
      .then(function (resp) {
        if (resp && resp.ok) {
          var copia = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return resp;
      })
      .catch(function () {
        return caches.match(req).then(function (cacheada) {
          // Navegação offline cai na casca do app; ele mostra a tela de entrada
          // e falha ao falar com a API, com a mensagem de sempre.
          return cacheada || caches.match("/index.html");
        });
      })
  );
});
