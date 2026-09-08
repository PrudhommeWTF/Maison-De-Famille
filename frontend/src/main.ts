import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { Racine } from './app/racine';
import { ROUTES } from './app/routes';

bootstrapApplication(Racine, {
  providers: [
    // Sans zone.js : l'état de l'application est porté par des signals, et la
    // détection de changement suit les signals. C'est plus rapide et plus
    // prévisible qu'une détection déclenchée par chaque minuterie du navigateur.
    provideZonelessChangeDetection(),
    // `anchorScrolling` : « Activer dans les Réglages », depuis la vue
    // d'ensemble de l'administration, vise la section Exploitation par son
    // ancre. Sans cette option, le lien ouvre la page en haut et laisse
    // chercher.
    provideRouter(ROUTES, withInMemoryScrolling({
      scrollPositionRestoration: 'top', anchorScrolling: 'enabled',
    })),
  ],
}).catch((e) => {
  // Une panne au démarrage laisserait une page blanche sans explication : mieux
  // vaut un message que rien.
  document.body.innerHTML =
    '<div style="font-family:system-ui;padding:40px;max-width:520px">'
    + '<h1 style="font-size:20px">L\'application n\'a pas pu démarrer</h1>'
    + '<p>Rechargez la page. Si le problème persiste, le journal du serveur '
    + '(<code>journalctl -u maison-de-famille</code>) dira ce qui manque.</p>'
    + `<pre style="white-space:pre-wrap;color:#8d4a2e">${String(e)}</pre></div>`;
});
