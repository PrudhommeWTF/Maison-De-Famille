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
    :host { display: block; min-height: 100vh; }

    header {
      position: sticky; top: 0; z-index: 30; height: var(--hauteur-entete);
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      padding: 0 20px; background: var(--surface); border-bottom: 1px solid var(--bordure-carte);
    }
    .marque { display: flex; align-items: center; gap: 9px; font-family: var(--titre); font-size: 16px; font-weight: 500; }
    .marque i { color: var(--accent); font-size: 18px; }

    .barre-contexte {
      position: sticky; top: var(--hauteur-entete); z-index: 25;
      display: flex; align-items: center; gap: 8px; overflow-x: auto;
      padding: 9px 20px; min-height: var(--hauteur-contexte);
      background: var(--fond-contexte); border-bottom: 1px solid var(--bordure-contexte);
    }
    .pilule {
      display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
      padding: 7px 14px; min-height: 36px; border-radius: 20px; border: none;
      background: transparent; color: var(--encre-2); font-size: 13px; cursor: pointer;
      font-family: inherit; transition: background 140ms, color 140ms;
    }
    .pilule:hover { background: rgba(36, 32, 27, .06); }
    .pilule[aria-current="true"] { background: var(--encre); color: var(--surface); }
    .pilule[aria-current="true"]:hover { background: var(--encre); }

    .grille { display: grid; grid-template-columns: var(--nav) minmax(0, 1fr); align-items: start; }

    /* La navigation latérale et la barre d'onglets sont toutes deux des <nav> :
       chacune porte sa classe, sinon la seconde hérite du positionnement
       collant de la première et s'étire sur toute la hauteur de l'écran. */
    .laterale {
      position: sticky; top: calc(var(--hauteur-entete) + var(--hauteur-contexte));
      max-height: calc(100vh - var(--hauteur-entete) - var(--hauteur-contexte));
      overflow-y: auto; padding: 20px 14px 40px;
    }
    .laterale .libelle-section { margin: 16px 8px 7px; display: block; }
    /* Le nom du bien porte son icône, comme dans la maquette : c'est le seul
       intertitre qui désigne une chose et non une catégorie. */
    .laterale .titre-bien { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
    /* Le lieu et la structure sous le nom : ils disent dans quel dossier on est
       sans avoir à remonter à la barre de contexte. */
    .laterale .contexte-bien {
      display: block; margin: 0 8px 6px; font-size: 11.5px; color: var(--encre-3);
    }
    /* Les quatre groupes. Plus discrets que le nom du bien, sinon la navigation
       compte cinq titres de même poids et n'a plus de hiérarchie. */
    .laterale .libelle-groupe {
      display: block; margin: 13px 10px 4px; font-size: 11px; font-weight: 500;
      color: var(--encre-3);
    }
    .laterale .libelle-groupe:first-of-type { margin-top: 8px; }
    /* Le pied : ce que l'application est, et quand elle a été sauvegardée. */
    .laterale .pied {
      margin: 26px 8px 0; padding-top: 14px; border-top: 1px solid var(--separateur);
      font-size: 11px; color: var(--encre-3); line-height: 1.5;
    }
    .laterale a {
      display: flex; align-items: center; gap: 10px; padding: 9px 10px; min-height: 40px;
      border-radius: 8px; color: var(--encre-2); text-decoration: none; font-size: 13.5px;
    }
    .laterale a:hover { background: var(--survol-liste); }
    .laterale a.actif { background: var(--actif); color: var(--encre); font-weight: 500; }
    .laterale i { width: 18px; text-align: center; color: var(--encre-3); }
    .laterale a.actif i { color: var(--accent); }
    .badge {
      margin-left: auto; min-width: 20px; padding: 1px 6px; border-radius: 20px;
      background: var(--accent); color: var(--surface); font-size: 11.5px; text-align: center;
    }

    main { padding: 26px 30px 70px; max-width: var(--contenu-max); }

    .compte {
      display: flex; align-items: center; gap: 9px; border: none; background: none;
      cursor: pointer; font-family: inherit; padding: 6px; border-radius: 9px; min-height: 40px;
    }
    .compte:hover { background: var(--survol-liste); }
    .compte .nom { font-size: 13px; color: var(--encre-2); }

    .onglets { display: none; }

    @media (max-width: 900px) {
      .grille { grid-template-columns: minmax(0, 1fr); }
      .laterale { display: none; }
      main { padding: 18px 16px 90px; }
      .compte .nom { display: none; }
      .onglets {
        display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
        position: fixed; left: 0; right: 0; bottom: 0; top: auto; z-index: 40;
        background: var(--surface); border-top: 1px solid var(--bordure-carte);
        padding-bottom: env(safe-area-inset-bottom);
      }
      .onglets a {
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        padding: 9px 4px; min-height: 56px; text-decoration: none;
        color: var(--libelle-section); font-size: 11px;
      }
      .onglets a i { font-size: 17px; }
      .onglets a.actif { color: var(--accent); }
      .onglets a .badge { position: absolute; margin: 0; transform: translate(14px, -4px); }
    }
  `],
  template: `
    <header>
      <div class="marque"><i class="bi bi-houses" aria-hidden="true"></i>{{ etat.moi()?.instanceNom || 'Maison de Famille' }}</div>
      <button class="compte" routerLink="/compte" [attr.aria-label]="'Mon compte, ' + (etat.moi()?.personne?.nom || '')">
        <span class="nom">{{ etat.moi()?.personne?.nom }}</span>
        <span class="avatar">{{ initiales(etat.moi()?.personne?.nom || '') }}</span>
      </button>
    </header>

    @if (etat.sessionLimitee()) {
      <div class="encart" style="margin:16px 20px 0">
        Le second facteur est obligatoire pour les gérants sur cette instance.
        <a routerLink="/compte">Activez-le pour retrouver l'accès complet.</a>
      </div>
    }

    <!-- La barre de contexte : le pivot de toute l'application. -->
    @if (etat.biens().length > 1) {
      <div class="barre-contexte" role="group" aria-label="Bien affiché">
        <button class="pilule" [attr.aria-current]="etat.contexte() === TOUS" (click)="choisir(TOUS)">
          <i class="bi bi-houses" aria-hidden="true"></i> Tous les biens
        </button>
        @for (b of etat.biens(); track b.id) {
          <button class="pilule" [attr.aria-current]="etat.contexte() === b.id" (click)="choisir(b.id)">
            <i class="bi" [class]="icoBien(b.type)" aria-hidden="true"></i> {{ b.nom }}
          </button>
        }
      </div>
    }

    <div class="grille">
      <nav class="laterale" aria-label="Navigation principale">
        <span class="libelle-section">Portefeuille</span>
        @for (e of entreesPortefeuille(); track e.chemin) {
          <a [routerLink]="e.chemin" routerLinkActive="actif" [routerLinkActiveOptions]="{ exact: e.chemin === '/' }">
            <i class="bi" [class]="e.icone" aria-hidden="true"></i>{{ e.libelle }}
          </a>
        }

        @if (etat.bien(); as b) {
          <span class="libelle-section titre-bien">
            <i class="bi bi-house-door" aria-hidden="true"></i>{{ b.nom }}
          </span>
          <span class="contexte-bien">{{ b.commune }} · {{ b.structureNom }}</span>
          @for (g of groupesBien(); track g.titre) {
            <span class="libelle-groupe">{{ g.titre }}</span>
            @for (e of g.entrees; track e.chemin) {
              <a [routerLink]="e.chemin" routerLinkActive="actif">
                <i class="bi" [class]="e.icone" aria-hidden="true"></i>{{ e.libelle }}
                @if (e.badge && etat.demandesEnAttente() > 0) {
                  <span class="badge">{{ etat.demandesEnAttente() }}</span>
                }
              </a>
            }
          }
        }
        <!-- La maquette met aussi « Dernière sauvegarde : hier 03:00 ». Le
             serveur n'expose pas encore cette date : l'écrire en dur serait
             une promesse que rien ne tient. La ligne viendra avec le champ. -->
        <div class="pied">Auto-hébergé · vos données ne sortent pas d'ici</div>
      </nav>

      <main><router-outlet /></main>
    </div>

    <nav class="onglets" aria-label="Navigation">
      @for (e of onglets(); track e.chemin) {
        <a [routerLink]="e.chemin" routerLinkActive="actif" [routerLinkActiveOptions]="{ exact: e.chemin === '/' }">
          <i class="bi" [class]="e.icone" aria-hidden="true"></i>
          <span>{{ e.libelle }}</span>
          @if (e.badge && etat.demandesEnAttente() > 0) { <span class="badge">{{ etat.demandesEnAttente() }}</span> }
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
