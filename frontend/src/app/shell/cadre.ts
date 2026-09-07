// Le cadre de l'application : en-tête, barre de contexte, navigation, contenu.
//
// La structure vient directement de la maquette :
//
//   En-tête global (identité, utilisateur courant)
//   └─ Barre de contexte du bien  ← PIVOT
//      └─ Grille : navigation latérale 236 px | contenu
//
// Sur mobile, la navigation latérale disparaît au profit d'une barre d'onglets
// basse à trois entrées. Ce n'est pas une variante : c'est le même écran, la
// même route et les mêmes données, avec une mise en page qui tient au pouce.
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Etat, TOUS } from '../core/etat';
import { initiales } from '../core/format';

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
  selector: 'app-cadre',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* Presque rien : la mise en page vient entièrement de Bootstrap. Ne restent
       que les trois choses qu'aucun utilitaire n'exprime. */

    /* Les deux barres collantes s'empilent, et la latérale se cale sous elles. */
    .barre-contexte { top: var(--mdf-entete); z-index: 1020; }
    .laterale { top: calc(var(--mdf-entete) + var(--mdf-contexte)); width: 230px; max-width: 100%; }

    /* La barre d'onglets du pouce : fixée en bas, hors du flux, et respectant
       la zone sûre des téléphones à encoche. */
    .onglets {
      position: fixed; inset: auto 0 0 0; z-index: 1040;
      padding-bottom: env(safe-area-inset-bottom);
    }
    .onglets .nav-link.active { color: var(--bs-primary); }

    @media (max-width: 767.98px) { main { padding-bottom: 5rem; } }
  `],
  template: `
    <nav class="navbar bg-body border-bottom sticky-top px-3 py-2" style="z-index:1040">
      <div class="d-flex align-items-center gap-3 w-100">
        <span class="navbar-brand d-flex align-items-center gap-2 me-0">
          <span class="d-grid bg-primary text-white rounded-3" style="width:32px;height:32px;place-items:center">
            <i class="bi bi-houses" aria-hidden="true"></i>
          </span>
          <span class="d-flex flex-column lh-sm">
            <span class="fs-6">{{ etat.moi()?.instanceNom || 'Maison de Famille' }}</span>
            @if (etat.biens().length) {
              <span class="text-body-secondary" style="font-size:.7rem">{{ sousTitre() }}</span>
            }
          </span>
        </span>
        <div class="flex-grow-1"></div>
        <a class="btn btn-sm btn-link text-body text-decoration-none d-flex align-items-center gap-2"
           routerLink="/compte" [attr.aria-label]="'Mon compte, ' + (etat.moi()?.personne?.nom || '')">
          <span class="text-end lh-sm d-none d-sm-block">
            <span class="d-block small">{{ etat.moi()?.personne?.nom }}</span>
            @if (etat.estGerant()) { <span class="d-block text-body-secondary" style="font-size:.7rem">Gérant</span> }
          </span>
          <span class="d-grid rounded-circle bg-secondary-subtle text-body-secondary"
                style="width:30px;height:30px;place-items:center;font-size:.7rem">{{ initiales(etat.moi()?.personne?.nom || '') }}</span>
        </a>
      </div>
    </nav>

    @if (etat.sessionLimitee()) {
      <div class="alert alert-primary rounded-0 border-start-0 border-end-0 mb-0">
        Le second facteur est obligatoire pour les gérants sur cette instance.
        <a routerLink="/compte" class="alert-link">Activez-le pour retrouver l'accès complet.</a>
      </div>
    }

    <!-- La barre de contexte : le pivot de toute l'application. -->
    @if (etat.biens().length > 1) {
      <div class="bg-body-tertiary border-bottom px-3 py-2 position-sticky barre-contexte">
        <div class="d-flex align-items-center gap-3 flex-wrap">
          <ul class="nav nav-pills gap-1 bg-body rounded-3 p-1" role="group" aria-label="Bien affiché">
            <li class="nav-item">
              <button class="nav-link py-1 px-3 d-flex align-items-center gap-2"
                      [class.active]="etat.contexte() === TOUS"
                      [attr.aria-current]="etat.contexte() === TOUS" (click)="choisir(TOUS)">
                <i class="bi bi-houses" aria-hidden="true"></i>Tous les biens
              </button>
            </li>
            @for (b of etat.biens(); track b.id) {
              <li class="nav-item">
                <button class="nav-link py-1 px-3 d-flex align-items-center gap-2"
                        [class.active]="etat.contexte() === b.id"
                        [attr.aria-current]="etat.contexte() === b.id" (click)="choisir(b.id)">
                  <i class="bi" [class]="icoBien(b.type)" aria-hidden="true"></i>{{ b.nom }}
                </button>
              </li>
            }
          </ul>
          @if (etat.contexte() === TOUS) {
            <div class="small text-secondary-emphasis d-none d-lg-flex align-items-center">
              <i class="bi bi-diagram-3 me-2 text-body-secondary" aria-hidden="true"></i>{{ sousTitre() }}
            </div>
          }
        </div>
      </div>
    }

    <div class="container-fluid px-0">
      <div class="row g-0">
        <div class="col-12 col-sm-auto d-none d-md-block">
          <nav class="position-sticky p-3 laterale overflow-auto" aria-label="Navigation principale">
            <div class="eyebrow px-2 pb-2">Portefeuille</div>
            <ul class="nav nav-pills flex-column gap-1 mb-4">
              @for (e of entreesPortefeuille(); track e.chemin) {
                <li class="nav-item">
                  <a class="nav-link side-link text-start w-100 d-flex align-items-center gap-2"
                     [routerLink]="e.chemin" routerLinkActive="active"
                     [routerLinkActiveOptions]="{ exact: e.chemin === '/' }">
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
                         [routerLink]="e.chemin" routerLinkActive="active">
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

            <!-- La maquette met aussi « Dernière sauvegarde : hier 03:00 ». Le
                 serveur n'expose pas encore cette date : l'écrire en dur serait
                 une promesse que rien ne tient. La ligne viendra avec le champ. -->
            <div class="small text-body-secondary border-top pt-3 mt-4 px-2 lh-sm">
              Auto-hébergé · vos données ne sortent pas d'ici
            </div>
          </nav>
        </div>

        <div class="col">
          <main class="p-3 p-lg-4"><router-outlet /></main>
        </div>
      </div>
    </div>

    <nav class="nav nav-justified bg-body border-top d-md-none onglets" aria-label="Navigation">
      @for (e of onglets(); track e.chemin) {
        <a class="nav-link d-flex flex-column align-items-center gap-1 py-2 small position-relative"
           [routerLink]="e.chemin" routerLinkActive="active"
           [routerLinkActiveOptions]="{ exact: e.chemin === '/' }">
          <i class="bi fs-5" [class]="e.icone" aria-hidden="true"></i>
          <span style="font-size:.7rem">{{ e.libelle }}</span>
          @if (e.badge && etat.demandesEnAttente() > 0) {
            <span class="badge rounded-pill text-bg-primary position-absolute top-0 end-50 translate-middle-x"
                  style="margin-left:1.4rem">{{ etat.demandesEnAttente() }}</span>
          }
        </a>
      }
    </nav>
  `,
})
export class Cadre {
  readonly etat = inject(Etat);
  private readonly router = inject(Router);
  readonly TOUS = TOUS;
  readonly initiales = initiales;

  /** « 2 biens, 2 structures » : dérivé, jamais saisi. */
  readonly sousTitre = computed(() => {
    const biens = this.etat.biens();
    const structures = new Set(biens.map((b) => b.structureId)).size;
    return `${biens.length} bien${biens.length > 1 ? 's' : ''} · `
      + `${structures} structure${structures > 1 ? 's' : ''}`;
  });

  readonly entreesPortefeuille = computed<Entree[]>(() => {
    const e: Entree[] = [{ chemin: '/', libelle: 'Tableau de bord', icone: 'bi-house-heart' }];
    if (this.etat.estGerant()) {
      e.push({ chemin: '/biens', libelle: 'Biens gérés', icone: 'bi-houses' });
      e.push({ chemin: '/personnes', libelle: 'Personnes et rôles', icone: 'bi-people' });
      e.push({ chemin: '/import', libelle: 'Import du planning', icone: 'bi-box-arrow-in-right' });
      e.push({ chemin: '/reglages', libelle: 'Réglages', icone: 'bi-sliders' });
      e.push({ chemin: '/etat', libelle: 'État du service', icone: 'bi-activity' });
    }
    return e;
  });

  /**
   * Les entrées d'un bien, groupées comme la maquette.
   *
   * Les règles de rôle sont inchangées : ce qui n'est pas accessible n'est pas
   * affiché, parce qu'une entrée de navigation qui mène à un refus ou à un
   * écran vide est un mensonge. Un groupe vidé par ces règles disparaît avec
   * son titre, plutôt que de laisser un intertitre sans rien dessous.
   */
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

  readonly onglets = computed<Entree[]>(() => this.etat.bien()
    ? [
      { chemin: '/', libelle: 'Accueil', icone: 'bi-house-heart' },
      { chemin: '/bien/calendrier', libelle: 'Calendrier', icone: 'bi-calendar3' },
      ...(this.etat.roleIci() !== 'invite' ? [
        { chemin: '/bien/demandes', libelle: 'Demandes', icone: 'bi-envelope-paper', badge: true },
      ] : [{ chemin: '/bien/coffre', libelle: 'Coffre', icone: 'bi-shield-lock' }]),
      { chemin: '/compte', libelle: 'Compte', icone: 'bi-person' },
    ]
    : [
      { chemin: '/', libelle: 'Accueil', icone: 'bi-house-heart' },
      { chemin: '/biens', libelle: 'Biens', icone: 'bi-houses' },
      { chemin: '/compte', libelle: 'Compte', icone: 'bi-person' },
    ]);

  icoBien(type: string): string {
    return type === 'montagne' ? 'bi-triangle' : type === 'ville' ? 'bi-building' : type === 'campagne' ? 'bi-tree' : 'bi-water';
  }

  /** Changer de bien réinitialise sur le tableau de bord, comme dans la maquette. */
  choisir(c: number | typeof TOUS): void {
    this.etat.poserContexte(c);
    void this.router.navigate(['/']);
  }
}
