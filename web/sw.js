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

// v2 porque a casca do app mudou de endereco: a v1 guarda o APP em "/", que
// agora e o site. Trocar o nome do cache e o que faz o activate apagar o
// antigo -- sem isso, quem ja tinha o app instalado continuaria com o app
// velho guardado no lugar do site, e offline veria o app onde devia ver o
// site.
var CACHE = "saldonline-v2";
var CASCA = ["/home", "/home.html", "/config.js", "/manifest.webmanifest",
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
          return cacheada || caches.match("/home.html");
        });
      })
  );
});

// ---------------------------------------------------------------- avisos
// O aviso que chega com o app FECHADO. O número no menu e no ícone só
// alcança quem já abriu; isto alcança quem não abriu.
//
// O que chega aqui é um número e duas frases, e nada mais: nem valor, nem
// lojista, nem banco. A notificação aparece na tela bloqueada, onde quem
// está ao lado também lê — e "5 lançamentos esperando" não conta a ninguém
// o que você gastou.

self.addEventListener("push", function (e) {
  var dados = {};
  // Corpo ilegível não pode derrubar o aviso: melhor um texto genérico que
  // nenhuma notificação.
  try { dados = e.data ? e.data.json() : {}; } catch (err) { dados = {}; }

  var titulo = dados.titulo || "Tem lançamento esperando você";
  var texto = dados.texto || "O banco mandou novidade. Confira antes de importar.";

  e.waitUntil(
    Promise.all([
      self.registration.showNotification(titulo, {
        body: texto,
        icon: "/icons/icone-192.png",
        badge: "/icons/icone-192.png",
        // Mesma tag sempre: o aviso de hoje SUBSTITUI o de ontem em vez de
        // empilhar. Três avisos iguais na gaveta não dizem mais que um.
        tag: "saldonline-pendentes",
        renotify: false,
        data: { ir: "/home" }
      }),
      // E o ícone atualiza mesmo com o app fechado — que é justamente o que
      // o badge sozinho não consegue fazer.
      dados.total && "setAppBadge" in self.navigator
        ? self.navigator.setAppBadge(dados.total).catch(function () {})
        : Promise.resolve()
    ])
  );
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var destino = (e.notification.data && e.notification.data.ir) || "/home";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (abertas) {
      // Já tem o app aberto: traz para a frente em vez de abrir uma segunda
      // janela da mesma coisa.
      for (var i = 0; i < abertas.length; i++) {
        if (abertas[i].url.indexOf(self.location.origin) === 0 && "focus" in abertas[i]) {
          abertas[i].navigate(destino).catch(function () {});
          return abertas[i].focus();
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
