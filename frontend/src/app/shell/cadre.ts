// Le cadre de l'application : en-tête, barre de contexte, navigation, contenu.
//
// La structure vient directement de la maquette :
//
//   En-tête global (identité, utilisateur courant)
//   └─ Barre de contexte du bien  ← PIVOT
//      └─ Grille : navigation latérale 236 px | contenu
//
// Sur mobile, la navigation latérale devient un tiroir, ouvert depuis la barre
// basse. Ce n'est pas une variante : c'est le même écran, la même route, les
// mêmes données et **la même liste d'entrées** (`app-navigation`), avec une mise
// en page qui tient au pouce.
//
// Le tiroir est piloté par un signal, pas par les attributs `data-bs-*` : le
// paquet de transmission le dit lui-même, le data-api de Bootstrap manipule le
// DOM directement et le rendu du composant l'écrase. Poser la classe `show`
// nous-mêmes évite d'embarquer le JavaScript de Bootstrap pour un seul
// composant.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Etat, TOUS } from '../core/etat';
import { initiales } from '../core/format';
import { Navigation } from './navigation';

interface Entree { chemin: string; libelle: string; icone: string; badge?: boolean }

@Component({
  selector: 'app-cadre',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Navigation],
  host: {
    '(document:keydown.escape)': 'menuOuvert.set(false)',
    '(window:resize)': 'ajusterAuFormat()',
  },
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
            <app-navigation />
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
           [routerLinkActiveOptions]="{ exact: e.chemin === '/' }" (click)="menuOuvert.set(false)">
          <i class="bi fs-5" [class]="e.icone" aria-hidden="true"></i>
          <span style="font-size:.7rem">{{ e.libelle }}</span>
          @if (e.badge && etat.demandesEnAttente() > 0) {
            <span class="badge rounded-pill text-bg-primary position-absolute top-0 end-50 translate-middle-x"
                  style="margin-left:1.4rem">{{ etat.demandesEnAttente() }}</span>
          }
        </a>
      }
      <!-- Le reste de la navigation. Sans cette entrée, dix écrans sur quinze
           n'avaient aucun chemin au doigt : ils existaient sans exister. -->
      <button class="nav-link d-flex flex-column align-items-center gap-1 py-2 small border-0 bg-transparent"
              type="button" [class.active]="menuOuvert()" [attr.aria-expanded]="menuOuvert()"
              aria-controls="menu-mobile" (click)="menuOuvert.set(!menuOuvert())">
        <i class="bi bi-list fs-5" aria-hidden="true"></i>
        <span style="font-size:.7rem">Menu</span>
      </button>
    </nav>

    <!-- Le tiroir de navigation, et son voile. Tous deux sont posés par l'état,
         jamais par le data-api de Bootstrap. -->
    @if (menuOuvert()) {
      <div class="offcanvas-backdrop fade show d-md-none" (click)="menuOuvert.set(false)"></div>
    }
    <div class="offcanvas offcanvas-end d-md-none" [class.show]="menuOuvert()" id="menu-mobile"
         tabindex="-1" aria-label="Navigation">
      <div class="offcanvas-header border-bottom">
        <div>
          <div class="fw-medium">{{ etat.moi()?.personne?.nom }}</div>
          <div class="text-body-secondary" style="font-size:.72rem">{{ sousTitre() }}</div>
        </div>
        <button class="btn-close" type="button" aria-label="Fermer le menu"
                (click)="menuOuvert.set(false)"></button>
      </div>
      <div class="offcanvas-body">
        <app-navigation (naviguer)="menuOuvert.set(false)" />
        <a class="btn btn-outline-secondary w-100 mt-3" routerLink="/compte" (click)="menuOuvert.set(false)">
          <i class="bi bi-person me-1" aria-hidden="true"></i>Mon compte
        </a>
      </div>
    </div>
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

  readonly onglets = computed<Entree[]>(() => this.etat.bien()
    ? [
      { chemin: '/', libelle: 'Accueil', icone: 'bi-house-heart' },
      { chemin: '/bien/calendrier', libelle: 'Calendrier', icone: 'bi-calendar3' },
      ...(this.etat.roleIci() !== 'invite' ? [
        { chemin: '/bien/demandes', libelle: 'Demandes', icone: 'bi-envelope-paper', badge: true },
      ] : [{ chemin: '/bien/coffre', libelle: 'Coffre', icone: 'bi-shield-lock' }]),
    ]
    : [
      { chemin: '/', libelle: 'Accueil', icone: 'bi-house-heart' },
      { chemin: '/biens', libelle: 'Biens', icone: 'bi-houses' },
    ]);

  /**
   * Le tiroir de navigation du doigt.
   *
   * Fermé à chaque changement de bien : la barre de contexte ramène au tableau
   * de bord, et laisser le tiroir ouvert par-dessus donnerait l'impression que
   * le clic n'a rien fait.
   */
  readonly menuOuvert = signal(false);

  private readonly document = inject(DOCUMENT);

  constructor() {
    // Le corps ne défile pas derrière un tiroir ouvert. Bootstrap le fait
    // d'ordinaire depuis son JavaScript, qu'on n'embarque pas : trois lignes
    // ici valent mieux qu'une dépendance de plus.
    effect(() => {
      this.document.body.style.overflow = this.menuOuvert() ? 'hidden' : '';
    });
  }

  icoBien(type: string): string {
    return type === 'montagne' ? 'bi-triangle' : type === 'ville' ? 'bi-building' : type === 'campagne' ? 'bi-tree' : 'bi-water';
  }

  /**
   * Le tiroir n'existe qu'au format étroit. En passant au format large il est
   * masqué par la feuille de style, et le laisser « ouvert » verrouillerait le
   * défilement de la page sans que rien ne l'explique : c'est ce qui arrive en
   * tournant une tablette.
   */
  ajusterAuFormat(): void {
    if (this.menuOuvert() && window.innerWidth >= 768) this.menuOuvert.set(false);
  }

  /** Changer de bien réinitialise sur le tableau de bord, comme dans la maquette. */
  choisir(c: number | typeof TOUS): void {
    this.menuOuvert.set(false);
    this.etat.poserContexte(c);
    void this.router.navigate(['/']);
  }
}
