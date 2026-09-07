// L'administration de l'instance : un écran, six sections, une navigation.
//
// **Pourquoi cet écran existe.** Les réglages et l'état du service étaient deux
// entrées de menu séparées, et personne ne savait laquelle ouvrir. La version
// installée et le bouton « Vérifier les mises à jour » vivaient des deux côtés,
// le second renvoyant au premier ; la file de courriel était dans l'un, le
// réglage du relais dans l'autre. Chercher une information devenait une visite
// guidée.
//
// Tout est donc réuni ici, avec une navigation qui **dit ce que chaque section
// contient**. Une section par sujet, et le sujet le plus fréquent (« est-ce que
// tout va bien, et suis-je à jour ? ») en page d'arrivée.
//
// Chaque section est une route fille : une adresse se met en favori, se colle
// dans un message, et le bouton « précédent » du navigateur fait ce qu'on
// attend.
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-administration',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* La colonne des sections suit le défilement du contenu, qui est long. Elle
       ne le fait qu'au format large : au doigt, elle est au-dessus. */
    @media (min-width: 768px) {
      .sections { position: sticky; top: calc(var(--mdf-entete) + var(--mdf-contexte) + 1rem); }
    }
  `],
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Administration</h1>
        <p class="text-body-secondary mb-0">
          Les réglages de l'instance, sa santé et ses mises à jour, au même endroit.
        </p>
      </div>

      <div class="row g-4">
        <div class="col-12 col-md-4 col-xl-3">
          <!-- Chaque entrée porte une phrase : un intitulé seul (« Données »)
               oblige à ouvrir pour savoir, ce qui est exactement le problème
               qu'on répare. -->
          <nav class="nav nav-pills flex-column gap-1 sections" aria-label="Sections de l'administration">
            @for (s of SECTIONS; track s.chemin) {
              <a class="nav-link side-link text-start d-flex gap-3 align-items-start"
                 [routerLink]="s.chemin" routerLinkActive="active"
                 [routerLinkActiveOptions]="{ exact: s.chemin === '/administration' }">
                <i class="bi text-body-secondary mt-1" [class]="s.icone" aria-hidden="true"></i>
                <span>
                  <span class="d-block">{{ s.libelle }}</span>
                  <span class="d-block text-body-secondary lh-sm" style="font-size:.72rem">{{ s.quoi }}</span>
                </span>
              </a>
            }
          </nav>
        </div>

        <div class="col-12 col-md-8 col-xl-9">
          <router-outlet />
        </div>
      </div>
    </div>
  `,
})
export class Administration {
  readonly SECTIONS = [
    {
      chemin: '/administration', icone: 'bi-speedometer2', libelle: "Vue d'ensemble",
      quoi: 'Version installée, mises à jour, santé du service',
    },
    {
      chemin: '/administration/reglages', icone: 'bi-sliders', libelle: 'Réglages',
      quoi: "Nom de l'instance, sécurité, courriel, fichiers, journalisation",
    },
    {
      chemin: '/administration/vacances', icone: 'bi-calendar-range', libelle: 'Vacances scolaires',
      quoi: 'Le calendrier officiel des trois zones',
    },
    {
      chemin: '/administration/courriel', icone: 'bi-envelope', libelle: 'Courriel',
      quoi: 'La file d\'envoi et les erreurs du relais',
    },
    {
      chemin: '/administration/donnees', icone: 'bi-database', libelle: 'Données',
      quoi: 'Export, base de données, migrations appliquées',
    },
    {
      chemin: '/administration/serveur', icone: 'bi-terminal', libelle: 'Serveur',
      quoi: 'Les commandes utiles sur la machine',
    },
  ];
}
