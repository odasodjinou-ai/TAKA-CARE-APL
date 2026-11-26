// Service worker minimal : rend le jeu installable sur l'écran d'accueil.
// Aucune mise en cache : le jeu se met toujours à jour depuis le serveur.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
