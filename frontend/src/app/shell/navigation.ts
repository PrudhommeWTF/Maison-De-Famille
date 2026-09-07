// La navigation : les entrées du portefeuille, puis celles du bien ouvert.
//
// Un seul fichier pour deux emplacements, et c'est le point. Au bureau elle
// tient dans la colonne de gauche, au doigt dans un tiroir qu'on ouvre depuis
// la barre basse. Les deux montrent **exactement** la même chose : dupliquer la
// liste, c'était se garantir qu'un jour une entrée n'existerait que d'un côté.
//
// Les règles de rôle vivent ici, et nulle part ailleurs : ce qui n'est pas
// accessible n'est pas affiché, parce qu'une entrée de navigation qui mène à un
// refus ou à un écran vide est un mensonge.
import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Etat } from '../core/etat';

interface Entree { chemin: string; libelle: string; icone: string; badge?: boolean }

/**
 * Un groupe d'entrées dans la navigation d'un bien.
 *
 * La maquette range les onze écrans d'un bien en quatre groupes : Séjours,
 * Argent, Maison, Famille. Ce n'est pas de la décoration. Onze liens à plat
 * forment une liste qu'on relit à chaque fois ; quatre groupes de trois forment
 * une carte mentale qu'on retient. Un groupe dont toutes les entrées sont
 * masquées par les règles de rôle ne s'affiche pas du tout, titre compris.
 */
interface Groupe { titre: string; entrees: Entree[] }

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="eyebrow px-2 pb-2">Portefeuille</div>
    <ul class="nav nav-pills flex-column gap-1 mb-4">
      @for (e of entreesPortefeuille(); track e.chemin) {
        <li class="nav-item">
          <a class="nav-link side-link text-start w-100 d-flex align-items-center gap-2"
             [routerLink]="e.chemin" routerLinkActive="active"
             [routerLinkActiveOptions]="{ exact: e.chemin === '/' }" (click)="naviguer.emit()">
            <i class="bi text-body-secondary" [class]="e.icone" aria-hidden="true"></i>{{ e.libelle }}
          </a>
        </li>
      }
    </ul>

    @if (etat.bien(); as b) {
      <div class="d-flex align-items-center gap-2 bg-body-secondary rounded-3 px-3 py-2 mb-1">
        <i class="bi bi-house-door text-secondary-emphasis" aria-hidden="true"></i>
        <span class="fw-medium text-truncate">{{ b.nom }}</span>
      </div>
      <div class="small text-body-secondary px-3 mb-3">{{ b.commune }} · {{ b.structureNom }}</div>

      @for (g of groupesBien(); track g.titre) {
        <div class="eyebrow px-2 pb-2">{{ g.titre }}</div>
        <ul class="nav nav-pills flex-column gap-1 mb-4">
          @for (e of g.entrees; track e.chemin) {
            <li class="nav-item">
              <a class="nav-link side-link text-start w-100 d-flex align-items-center gap-2"
                 [routerLink]="e.chemin" routerLinkActive="active" (click)="naviguer.emit()">
                <i class="bi text-body-secondary" [class]="e.icone" aria-hidden="true"></i>
                <span class="flex-grow-1">{{ e.libelle }}</span>
                @if (e.badge && etat.demandesEnAttente() > 0) {
                  <span class="badge rounded-pill text-bg-primary">{{ etat.demandesEnAttente() }}</span>
                }
              </a>
            </li>
          }
        </ul>
      }
    }

    <!-- La maquette met aussi « Dernière sauvegarde : hier 03:00 ». Le serveur
         n'expose pas encore cette date : l'écrire en dur serait une promesse que
         rien ne tient. La ligne viendra avec le champ. -->
    <div class="small text-body-secondary border-top pt-3 mt-4 px-2 lh-sm">
      Auto-hébergé · vos données ne sortent pas d'ici
    </div>
  `,
})
export class Navigation {
  readonly etat = inject(Etat);

  /** Émis à chaque clic sur une entrée : le tiroir mobile s'en sert pour se refermer. */
  readonly naviguer = output<void>();

  readonly entreesPortefeuille = computed<Entree[]>(() => {
    const e: Entree[] = [{ chemin: '/', libelle: 'Tableau de bord', icone: 'bi-house-heart' }];
    if (this.etat.estGerant()) {
      e.push({ chemin: '/biens', libelle: 'Biens gérés', icone: 'bi-houses' });
      e.push({ chemin: '/personnes', libelle: 'Personnes et rôles', icone: 'bi-people' });
      e.push({ chemin: '/import', libelle: 'Import du planning', icone: 'bi-box-arrow-in-right' });
      // Une seule entrée pour les réglages ET l'état du service : les deux
      // écrans se renvoyaient l'un à l'autre, et on ne savait jamais lequel
      // ouvrir pour trouver quoi.
      e.push({ chemin: '/administration', libelle: 'Administration', icone: 'bi-sliders' });
    }
    return e;
  });

  readonly groupesBien = computed<Groupe[]>(() => {
    const membre = this.etat.roleIci() !== 'invite';
    const parts = this.etat.vocabulaire().parts;

    const groupes: Groupe[] = [
      {
        titre: 'Séjours',
        entrees: [
          { chemin: '/bien/calendrier', libelle: "Calendrier d'occupation", icone: 'bi-calendar3' },
          // Un invité ne dépose pas de demande : il en a un, c'est la raison de
          // son accès. L'entrée le menait à un écran où il n'y avait rien à
          // faire et rien à lire qui le concerne.
          ...(membre ? [
            { chemin: '/bien/demandes', libelle: 'Demandes de séjour', icone: 'bi-envelope-paper', badge: true },
          ] : []),
        ],
      },
      {
        titre: 'Argent',
        entrees: [
          // L'argent n'est visible que de qui a le droit de le voir.
          ...(this.etat.voitLArgent() ? [
            { chemin: '/bien/depenses', libelle: 'Dépenses & répartition', icone: 'bi-receipt' },
            { chemin: '/bien/soldes', libelle: 'Soldes & remboursements', icone: 'bi-arrow-left-right' },
          ] : []),
          // « La location est activable par bien » : sur un bien qui n'est pas
          // loué, l'entrée n'existe pas.
          ...(this.etat.bien()?.locationActivee && this.etat.voitLArgent() ? [
            { chemin: '/bien/location', libelle: 'Location saisonnière', icone: 'bi-key' },
          ] : []),
        ],
      },
      {
        titre: 'Maison',
        entrees: [
          // Savoir que la chaudière est contrôlée intéresse tout le monde, mais
          // pas un invité de passage.
          ...(membre ? [
            { chemin: '/bien/entretien', libelle: "Carnet d'entretien", icone: 'bi-tools' },
          ] : []),
          { chemin: '/bien/fiche', libelle: 'Fiche du bien', icone: 'bi-journal-bookmark' },
          // Le coffre-fort s'affiche pour tous : son contenu est filtré par
          // portée, et un invité en séjour y trouve le code du portail.
          { chemin: '/bien/coffre', libelle: 'Coffre-fort', icone: 'bi-shield-lock' },
        ],
      },
      {
        titre: 'Famille',
        entrees: membre ? [
          { chemin: '/bien/decisions', libelle: 'Décisions & votes', icone: 'bi-hand-thumbs-up' },
          { chemin: '/bien/souvenirs', libelle: 'Souvenirs', icone: 'bi-images' },
          { chemin: '/bien/membres', libelle: `Membres & ${parts}`, icone: 'bi-people' },
        ] : [],
      },
    ];
    return groupes.filter((g) => g.entrees.length > 0);
  });
}
