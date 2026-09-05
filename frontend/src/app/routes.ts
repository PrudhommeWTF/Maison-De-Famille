// Les routes.
//
// Deux règles reprises de la maquette :
//
//   - en vue « Tous les biens », seuls le tableau de bord consolidé et la liste
//     des biens ont un sens ; **toute autre route redirige** vers le tableau de
//     bord plutôt que d'afficher un écran vide ;
//   - les écrans d'un bien vivent sous `/bien/...` et se ferment quand aucun
//     bien n'est ouvert.
//
// La garde est ici, une fois, et non répétée dans chaque composant.
import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from './core/api';
import { Etat, TOUS } from './core/etat';

/**
 * Une session est ouverte, et l'état est chargé.
 *
 * Le chargement se fait **ici** et non dans le composant du cadre : les gardes
 * des routes filles s'exécutent avant qu'un composant parent n'existe. Charger
 * dans le constructeur du cadre laissait la garde « un bien est-il ouvert ? »
 * décider sur un état encore vide, et un favori sur le calendrier retombait
 * toujours sur le tableau de bord.
 */
const connecte = async () => {
  const api = inject(Api);
  const etat = inject(Etat);
  const router = inject(Router);
  if (!api.connecte()) return router.createUrlTree(['/connexion']);
  if (etat.moi()) return true;
  try {
    await etat.charger();
    return true;
  } catch {
    // Le jeton ne vaut plus rien : retour à la connexion, plutôt qu'une
    // application vide dont on ne comprend pas ce qui manque.
    api.oublierSession();
    return router.createUrlTree(['/connexion']);
  }
};

/** Un bien est-il ouvert ? Sinon, retour au tableau de bord consolidé. */
const bienOuvert = () => {
  const etat = inject(Etat);
  const router = inject(Router);
  return etat.contexte() !== TOUS ? true : router.createUrlTree(['/']);
};

/** Réservé aux gérants : l'écran répondrait 403 de toute façon. */
const gerant = () => {
  const etat = inject(Etat);
  const router = inject(Router);
  return etat.estGerant() ? true : router.createUrlTree(['/']);
};

export const ROUTES: Routes = [
  {
    path: 'connexion',
    loadComponent: () => import('./shell/connexion').then((m) => m.Connexion),
    title: 'Connexion',
  },
  {
    path: 'reinitialiser',
    loadComponent: () => import('./shell/reinitialisation').then((m) => m.Reinitialisation),
    title: 'Nouveau mot de passe',
  },
  {
    path: '',
    canActivate: [connecte],
    loadComponent: () => import('./shell/cadre').then((m) => m.Cadre),
    children: [
      { path: '', loadComponent: () => import('./ecrans/tableau-de-bord').then((m) => m.TableauDeBord), title: 'Tableau de bord' },
      { path: 'biens', loadComponent: () => import('./ecrans/biens').then((m) => m.Biens), title: 'Biens gérés' },
      { path: 'compte', loadComponent: () => import('./ecrans/compte').then((m) => m.Compte), title: 'Mon compte' },
      {
        path: 'bien', canActivate: [bienOuvert],
        children: [
          { path: 'calendrier', loadComponent: () => import('./ecrans/calendrier').then((m) => m.Calendrier), title: 'Calendrier' },
          { path: 'demandes', loadComponent: () => import('./ecrans/demandes').then((m) => m.Demandes), title: 'Demandes de séjour' },
          { path: 'depenses', loadComponent: () => import('./ecrans/depenses').then((m) => m.Depenses), title: 'Dépenses et répartition' },
          { path: 'soldes', loadComponent: () => import('./ecrans/soldes').then((m) => m.Soldes), title: 'Soldes et remboursements' },
          { path: 'membres', loadComponent: () => import('./ecrans/membres').then((m) => m.Membres), title: 'Membres et quotes-parts' },
          { path: 'fiche', loadComponent: () => import('./ecrans/fiche').then((m) => m.Fiche), title: 'Fiche du bien' },
          { path: '', pathMatch: 'full', redirectTo: 'calendrier' },
        ],
      },
      { path: 'reglages', canActivate: [gerant], loadComponent: () => import('./ecrans/reglages').then((m) => m.Reglages), title: 'Réglages' },
      { path: 'import', canActivate: [gerant], loadComponent: () => import('./ecrans/import').then((m) => m.Import), title: 'Import du planning' },
      { path: 'etat', canActivate: [gerant], loadComponent: () => import('./ecrans/etat').then((m) => m.EtatSysteme), title: 'État du service' },
      { path: '**', redirectTo: '' },
    ],
  },
];
