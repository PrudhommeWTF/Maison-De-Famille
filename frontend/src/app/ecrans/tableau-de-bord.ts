// Le tableau de bord, portefeuille ou dossier d'un bien.
//
// Le contrat de tuile de la maquette : **le tableau de bord compose, il ne
// calcule rien**. Chaque bloc vient d'une source qui lui est propre, et l'écran
// ne connaît l'intérieur d'aucun module. Ajouter un domaine (les dépenses en
// tranche 2, les votes en tranche 4) consiste à ajouter une tuile, pas à rouvrir
// ce fichier.
//
// La page dépend du rôle, comme le dit la note de comportement : la gérante voit
// sa file d'attente, un indivisaire voit son prochain séjour.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Etat, TOUS } from '../core/etat';
import { dateCourte, euros, nuitsLisible, personnesLisible, plage } from '../core/format';
import { etapes } from '../core/demarrage';
import type { Etape } from '../core/demarrage';
import type { BienResume, Etat as EtatSysteme, ListeDepenses, Sejour, Soldes } from '../core/modeles';

interface Gouvernance { alertes: { structureNom: string }[] }

@Component({
  selector: 'app-tableau-de-bord',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      @if (etat.bien(); as b) {
        <div>
          <h1 class="h2 mb-2">{{ b.nom }}</h1>
          <p class="text-body-secondary mb-0">
            {{ b.commune }} · {{ b.couchages }} couchages
            @if (etat.roleIci() !== 'invite') {
              ·
              @if (etat.demandesEnAttente() > 0) {
                {{ etat.demandesEnAttente() }} demande{{ etat.demandesEnAttente() > 1 ? 's' : '' }} en attente
              } @else { aucune demande en attente }
            }
          </p>
        </div>

        @if (demarrage().length) {
          <!-- L'alerte plutôt que la carte : cette liste est une consigne, pas
               une donnée du bien, et elle s'efface d'elle-même une fois faite. -->
          <section class="alert alert-primary mb-0" role="status">
            <h2 class="h5 alert-heading">Pour démarrer</h2>
            <p class="small mb-0">
              Ce qu'il reste à faire pour que la famille puisse s'en servir. Cette carte
              disparaît d'elle-même, étape par étape.
            </p>
            @for (e of demarrage(); track e.cle) {
              <div class="d-flex gap-3 align-items-start border-top border-primary-subtle mt-3 pt-3">
                <i class="bi mt-1 flex-shrink-0" aria-hidden="true"
                   [class.bi-exclamation-circle]="e.bloquante" [class.bi-arrow-right-circle]="!e.bloquante"></i>
                <span class="flex-grow-1">
                  <span class="d-block small fw-medium">{{ e.titre }}</span>
                  <span class="d-block small">{{ e.pourquoi }}</span>
                </span>
                @if (e.lien) {
                  <a class="btn btn-sm btn-outline-primary flex-shrink-0" [routerLink]="e.lien">Y aller</a>
                }
              </div>
            }
          </section>
        }

        <section class="card">
          <div class="card-body d-flex flex-wrap gap-4 align-items-start">
            <div class="d-flex flex-wrap gap-4 flex-grow-1">
              <div>
                <div class="text-body-secondary small">Prochain séjour</div>
                <div class="fs-6 fw-medium mt-1">{{ prochain() ? plage(prochain()!.arrivee, prochain()!.depart) : 'Aucun' }}</div>
              </div>
              <div>
                <div class="text-body-secondary small">{{ b.occupationLibelle }}</div>
                <div class="fs-6 fw-medium mt-1 tnum">{{ b.occupationPourcent }} %</div>
              </div>
              <!-- L'arbitrage est une affaire de famille : un invité n'a ni le
                   chiffre, ni l'écran qui va avec, ni rien à en faire. -->
              @if (etat.roleIci() !== 'invite') {
                <div>
                  <div class="text-body-secondary small">À traiter</div>
                  <div class="fs-6 fw-medium mt-1 text-primary">{{ aTraiter(etat.demandesEnAttente()) }}</div>
                </div>
              }
              <div>
                <div class="text-body-secondary small">Nuits réservées à venir</div>
                <div class="fs-6 fw-medium mt-1 tnum">{{ nuitsAVenir() }}</div>
              </div>
            </div>
            <div class="d-flex gap-2 flex-wrap">
              <a class="btn btn-sm btn-outline-secondary" routerLink="/bien/calendrier">
                <i class="bi bi-calendar3 me-1"></i>Calendrier
              </a>
              @if (etat.roleIci() !== 'invite') {
                <a class="btn btn-sm btn-outline-secondary" routerLink="/bien/demandes">
                  <i class="bi bi-envelope-paper me-1"></i>Demandes
                </a>
              } @else {
                <a class="btn btn-sm btn-outline-secondary" routerLink="/bien/coffre">
                  <i class="bi bi-safe me-1"></i>Coffre-fort
                </a>
              }
              <a class="btn btn-sm btn-outline-secondary" routerLink="/bien/fiche">
                <i class="bi bi-journal-bookmark me-1"></i>Fiche
              </a>
            </div>
          </div>
        </section>
      } @else {
        <div>
          <h1 class="h2 mb-2">Bonjour {{ prenom() }}</h1>
          <p class="text-body-secondary mb-0">
            @if (etat.biens().length) {
              Vos biens et ce qui vous attend. Choisissez un bien pour entrer dans son dossier.
            } @else {
              Aucun bien ne vous est rattaché pour l'instant. Le gérant peut vous ajouter.
            }
          </p>
        </div>

        @if (etat.biens().length) {
          <div class="row row-cols-1 row-cols-md-2 g-3">
            @for (b of etat.biens(); track b.id) {
              <div class="col">
                <div class="card h-100 overflow-hidden" role="button" tabindex="0"
                     (click)="ouvrir(b)" (keydown.enter)="ouvrir(b)" (keydown.space)="ouvrir(b)">
                  <!-- Le bandeau garde la proportion de la maquette sans photo :
                       l'application n'en stocke pas pour un bien, et un cadre vide
                       serait un mensonge de plus qu'une icône franche. -->
                  <div class="ratio bg-body-tertiary" style="--bs-aspect-ratio:38%">
                    <div class="d-flex align-items-center justify-content-center text-body-secondary fs-3">
                      <i class="bi" [class]="ico(b.type)" aria-hidden="true"></i>
                    </div>
                  </div>
                  <div class="card-body">
                    <div class="d-flex justify-content-between align-items-baseline gap-2">
                      <h2 class="h5 card-title mb-0">{{ b.nom }}</h2>
                      <span class="small fw-medium flex-shrink-0" [class]="teinte(b.type)">
                        <i class="bi me-1" [class]="ico(b.type)" aria-hidden="true"></i>{{ typeLisible(b.type) }}
                      </span>
                    </div>
                    <p class="text-body-secondary small mb-2">
                      {{ b.commune }} · {{ b.couchages }} couchages@if (b.locationActivee) { · louée en saison }
                    </p>
                    <span class="badge rounded-pill text-bg-light border">{{ libelleStructure(b) }}</span>
                    <div class="d-flex gap-4 flex-wrap border-top mt-3 pt-3">
                      <div>
                        <div class="text-body-secondary" style="font-size:.7rem">Prochain séjour</div>
                        <div class="small fw-medium">{{ prochainDe(b.id) }}</div>
                      </div>
                      <div>
                        <div class="text-body-secondary" style="font-size:.7rem">{{ b.occupationLibelle }}</div>
                        <div class="small fw-medium tnum">{{ b.occupationPourcent }} %</div>
                      </div>
                      <div>
                        <div class="text-body-secondary" style="font-size:.7rem">À traiter</div>
                        <div class="small fw-medium" [class.text-primary]="b.demandesEnAttente > 0">
                          {{ aTraiter(b.demandesEnAttente) }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      }

      <div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3">
        <!-- Ce qui vous attend : agrège les demandes et les échéances, triées
             par date limite. Chaque ligne mène droit à l'écran concerné. -->
        @if (montreAttentes()) {
          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow mb-2"><i class="bi bi-bell me-2"></i>Ce qui vous attend</div>
                @if (attentes().length) {
                  <div class="list-group list-group-flush">
                    @for (a of attentes(); track a.lien + a.titre) {
                      <button class="list-group-item list-group-item-action d-flex gap-3 px-0 border-0"
                              (click)="aller(a.lien)">
                        <i class="bi text-primary" [class]="a.icone" aria-hidden="true"></i>
                        <span class="text-start">
                          <span class="d-block small fw-medium">{{ a.titre }}</span>
                          <span class="d-block text-body-secondary" style="font-size:.78rem">{{ a.sous }}</span>
                        </span>
                      </button>
                    }
                  </div>
                } @else {
                  <p class="text-body-secondary small mb-0">Rien à traiter pour le moment.</p>
                }
              </div>
            </section>
          </div>
        }

        <!-- La trésorerie. Le tableau de bord ne calcule rien : il compose ce
             que le module argent lui rend, et n'affiche la carte que s'il a
             quelque chose à dire. -->
        @if (tresorerie(); as t) {
          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow"><i class="bi bi-wallet2 me-2"></i>Trésorerie</div>
                <div class="fs-6 fw-medium mt-2 card-title">{{ t.titre }}</div>
                <div class="display-6 mt-2 tnum">{{ euros(t.montantCents) }}</div>
                <p class="text-body-secondary small mt-2 mb-0">{{ t.sousTitre }}</p>
                <ul class="list-group list-group-flush mt-3">
                  @for (l of t.lignes; track l.cle) {
                    <li class="list-group-item d-flex justify-content-between gap-2 px-0 small">
                      <span class="text-body-secondary">{{ l.cle }}</span>
                      <span class="fw-medium tnum">{{ l.valeur }}</span>
                    </li>
                  }
                </ul>
                <a class="btn btn-sm btn-outline-secondary w-100 mt-3" routerLink="/bien/soldes">Voir les soldes</a>
              </div>
            </section>
          </div>
        }

        <div class="col">
          <section class="card h-100">
            <div class="card-body">
              <div class="eyebrow mb-2"><i class="bi bi-suitcase-lg me-2"></i>Prochains séjours</div>
              @if (aVenir().length) {
                <ul class="list-group list-group-flush">
                  @for (s of aVenir(); track s.id) {
                    <li class="list-group-item d-flex gap-3 px-0">
                      <span class="text-body-secondary tnum flex-shrink-0"
                            style="font-size:.78rem;width:96px">{{ plage(s.arrivee, s.depart) }}</span>
                      <span>
                        <span class="d-block small fw-medium">{{ s.titre }}</span>
                        <span class="d-block text-body-secondary" style="font-size:.72rem">
                          {{ s.bienNom }} · {{ nuitsLisible(s.nuits) }}
                        </span>
                      </span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="text-body-secondary small mb-0">Aucun séjour prévu.</p>
              }
            </div>
          </section>
        </div>

        @if (monSejour(); as s) {
          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow mb-2"><i class="bi bi-person-check me-2"></i>Votre séjour</div>
                <div class="text-body-secondary small">{{ s.bienNom }}</div>
                <div class="fs-5 fw-medium mt-1 card-title">{{ plage(s.arrivee, s.depart) }}</div>
                <p class="text-body-secondary small mt-1 mb-3">
                  {{ nuitsLisible(s.nuits) }} · {{ personnesLisible(s.occupants) }} ·
                  {{ s.statut === 'valide' ? 'validé' : 'en attente de validation' }}
                </p>
                <a class="btn btn-sm btn-outline-secondary" routerLink="/bien/calendrier">Voir le calendrier</a>
              </div>
            </section>
          </div>
        }
      </div>
    </div>
  `,
})
export class TableauDeBord {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly plage = plage;
  readonly nuitsLisible = nuitsLisible;
  readonly personnesLisible = personnesLisible;

  readonly euros = euros;
  private readonly sejours = signal<Sejour[]>([]);
  private readonly demandes = signal<Sejour[]>([]);
  private readonly depenses = signal<ListeDepenses | null>(null);
  private readonly soldes = signal<Soldes | null>(null);
  /** Vrai quand les soldes agrègent plusieurs structures. */
  private readonly consolide = signal(false);
  private readonly faits = signal<Etape[]>([]);
  private readonly echeances = signal<{ id: number; libelle: string; bienNom: string; echeance: string; urgence: string }[]>([]);

  /**
   * Les étapes de démarrage. Le tableau de bord **compose** ici aussi : il
   * assemble des faits que chaque module rend sur ses propres routes, il ne
   * calcule rien lui-même, et le classement vit dans un module pur testé seul.
   */
  readonly demarrage = computed(() => (this.etat.estGerant() ? this.faits() : []));

  /**
   * Ce que le module argent a à dire au tableau de bord. Absent tant qu'aucune
   * dépense n'existe : une carte de trésorerie à zéro euro n'apprend rien.
   */
  readonly tresorerie = computed(() => {
    const d = this.depenses();
    const s = this.soldes();
    if (!d || !d.depenses.length) return null;
    const aRegulariser = (s?.soldes ?? [])
      .filter((x) => !x.estStructure && x.montantCents < 0)
      .reduce((t, x) => t - x.montantCents, 0);
    const structures = this.etat.structuresArgent();
    const consolide = this.consolide() && structures.length > 1;
    return {
      titre: consolide ? 'Trésorerie consolidée'
        : s ? `Trésorerie de ${s.structure.nom}` : 'Trésorerie',
      montantCents: d.total,
      sousTitre: consolide
        ? structures.map((x) => x.nom).join(' et ')
        : `Dépenses engagées sur l'exercice ${d.annee}`,
      lignes: [
        { cle: 'À régulariser', valeur: euros(aRegulariser) },
        { cle: 'Virements proposés', valeur: String(s?.virements.length ?? 0) },
      ],
    };
  });

  /**
   * Un invité n'a ni demande à arbitrer ni carnet d'entretien : la carte serait
   * vide à jamais, et une carte vide se retire. En vue consolidée aucun bien
   * n'est ouvert, et `roleIci()` répond « invité » par défaut : c'est donc le
   * rôle le plus large qui décide, sinon la gérante perdait sa file d'attente
   * dès qu'elle sortait d'un dossier.
   */
  readonly montreAttentes = computed(() => {
    const b = this.etat.bien();
    return b ? b.role !== 'invite' : this.etat.biens().some((x) => x.role !== 'invite');
  });

  readonly prenom = computed(() => (this.etat.moi()?.personne.nom ?? '').split(' ')[0]);

  /** Filtré sur le bien courant : la vue consolidée montre tout. */
  readonly aVenir = computed(() => {
    const b = this.etat.contexte();
    return this.sejours().filter((s) => b === TOUS || s.bienId === b).slice(0, 6);
  });

  readonly prochain = computed(() => this.aVenir()[0] ?? null);

  readonly nuitsAVenir = computed(() => this.aVenir().reduce((t, s) => t + s.nuits, 0));

  /** Le prochain séjour où la personne est elle-même demandeuse. */
  readonly monSejour = computed(() => {
    const moi = this.etat.moi()?.personne.id;
    return this.sejours().find((s) => s.demandeurId === moi) ?? null;
  });

  readonly attentes = computed(() => {
    const out: { titre: string; sous: string; lien: string; icone: string }[] = [];
    for (const d of this.demandes()) {
      out.push({
        titre: `Demande de ${d.titre}`,
        sous: `${d.bienNom} · ${plage(d.arrivee, d.depart)} · à arbitrer`,
        lien: '/bien/demandes', icone: 'bi-envelope-paper',
      });
    }
    // « La liste agrège demandes, votes ouverts et échéances d'entretien, triés
    // par date limite » : note de comportement de la maquette. Le tableau de
    // bord compose, il ne calcule rien : chaque module rend déjà sa liste.
    for (const e of this.echeances()) {
      out.push({
        titre: e.libelle,
        sous: `${e.bienNom} · ${e.urgence === 'en_retard' ? 'en retard depuis le' : 'avant le'} ${plage(e.echeance, e.echeance).replace('du ', '')}`,
        lien: '/bien/entretien', icone: e.urgence === 'en_retard' ? 'bi-exclamation-triangle' : 'bi-tools',
      });
    }
    const mien = this.sejours().find((s) => s.demandeurId === this.etat.moi()?.personne.id && s.statut === 'demande');
    if (mien) {
      out.push({
        titre: 'Votre demande est en attente',
        sous: `${mien.bienNom} · ${plage(mien.arrivee, mien.depart)}`,
        lien: '/bien/calendrier', icone: 'bi-hourglass-split',
      });
    }
    return out.slice(0, 6);
  });

  constructor() { void this.charger(); }

  /**
   * Les soldes de la ou des structures concernées.
   *
   * Sur un bien, c'est la sienne. En vue consolidée, ce sont toutes celles dont
   * la personne peut voir l'argent : la maquette parle de « Trésorerie
   * consolidée », et une famille avec une indivision et une SCI veut le total,
   * pas l'une des deux au hasard.
   */
  private async chargerSoldes(structureId: number | null): Promise<Soldes | null> {
    if (!this.etat.voitLArgentQuelquePart()) return null;
    if (structureId !== null) {
      return this.api.get<Soldes>(`/structures/${structureId}/soldes`).catch(() => null);
    }
    const parts = await Promise.all(this.etat.structuresArgent().map((s) =>
      this.api.get<Soldes>(`/structures/${s.id}/soldes`).catch(() => null)));
    const vus = parts.filter((p): p is Soldes => !!p);
    if (!vus.length) return null;
    // On agrège plutôt que de choisir : les soldes de chaque personne
    // s'additionnent, les virements proposés se concatènent.
    return {
      ...vus[0],
      soldes: vus.flatMap((p) => p.soldes),
      virements: vus.flatMap((p) => p.virements),
    };
  }

  private async charger(): Promise<void> {
    const bien = this.etat.bien();
    const [sejours, demandes, depenses, soldes, echeances] = await Promise.all([
      this.api.get<Sejour[]>('/sejours/a-venir').catch(() => [] as Sejour[]),
      this.etat.estGerant() ? this.api.get<Sejour[]>('/demandes').catch(() => [] as Sejour[]) : Promise.resolve([]),
      // En vue consolidée, aucun bien n'est ouvert : c'est le droit sur au
      // moins un bien qui décide, sinon la carte de trésorerie disparaissait
      // alors qu'il y avait bien de l'argent à montrer.
      this.etat.voitLArgentQuelquePart()
        ? this.api.get<ListeDepenses>(`/depenses${bien ? '?bienId=' + bien.id : ''}`).catch(() => null)
        : Promise.resolve(null),
      this.chargerSoldes(bien?.structureId ?? null),
      this.api.get<{ id: number; libelle: string; bienNom: string; echeance: string; urgence: string }[]>(
        '/entretien/echeances').catch(() => []),
    ]);
    this.echeances.set(echeances.filter((e) => e.urgence !== 'plus_tard'));
    this.sejours.set(sejours);
    this.demandes.set(demandes.filter((d) => this.etat.contexte() === TOUS || d.bienId === this.etat.contexte()));
    this.depenses.set(depenses);
    this.soldes.set(soldes);
    this.consolide.set(!bien);
    if (this.etat.estGerant()) void this.chargerDemarrage(sejours.length);
  }

  private async chargerDemarrage(sejoursVus: number): Promise<void> {
    const bien = this.etat.bien();
    const [systeme, gouvernance, detentions] = await Promise.all([
      this.api.get<EtatSysteme>('/etat').catch(() => null),
      this.api.get<Gouvernance>('/gouvernance').catch(() => null),
      bien
        ? this.api.get<{ actuelle: unknown[] }>(`/structures/${bien.structureId}/detentions`).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (!systeme) return;
    this.faits.set(etapes({
      personnes: systeme.donnees.personnes,
      structuresSansSecondGerant: (gouvernance?.alertes ?? []).map((a) => a.structureNom),
      // Sans bien ouvert (vue consolidée), on ne réclame pas une saisie qu'on
      // ne saurait pas où faire.
      quotesPartsSaisies: !bien || !!detentions?.actuelle.length,
      relaisConfigure: !!systeme.courriel.relais,
      adressePubliqueRenseignee: !!systeme.courriel.adressePublique,
      sejours: systeme.donnees.sejours || sejoursVus,
    }));
  }

  ico(type: string): string {
    return type === 'montagne' ? 'bi-triangle' : type === 'ville' ? 'bi-building' : type === 'campagne' ? 'bi-tree' : 'bi-water';
  }

  /**
   * La puce de structure, comme la maquette : « Indivision · 4 indivisaires »,
   * « SCI Prudhomme Immobilier · 3 associés ». Une indivision se nomme rarement
   * autrement que par son mode, une SCI porte un vrai nom : on montre celui des
   * deux qui apprend quelque chose.
   */
  libelleStructure(b: BienResume): string {
    const mode = b.structureMode === 'sci' ? 'SCI' : b.structureMode === 'nom_propre' ? 'Nom propre' : 'Indivision';
    const nom = b.structureMode === 'sci' ? b.structureNom : mode;
    if (!b.detenteurs) return nom;
    const qui = b.structureMode === 'sci' ? 'associé' : b.structureMode === 'nom_propre' ? 'propriétaire' : 'indivisaire';
    return `${nom} · ${b.detenteurs} ${qui}${b.detenteurs > 1 ? 's' : ''}`;
  }

  /** La couleur porte le type aussi vite que le mot, comme dans la maquette. */
  teinte(t: string): string {
    return t === 'montagne' ? 'text-info-emphasis' : t === 'ville' ? 'text-secondary-emphasis'
      : 'text-success-emphasis';
  }

  typeLisible(t: string): string {
    return t === 'montagne' ? 'Montagne' : t === 'ville' ? 'Ville'
      : t === 'campagne' ? 'Campagne' : 'Bord de mer';
  }

  /** « Claire, 4 juil. » : qui vient, et quand. Rien à afficher se dit. */
  prochainDe(bienId: number): string {
    const s = this.sejours().find((x) => x.bienId === bienId);
    if (!s) return 'Aucun';
    const qui = (s.demandeurNom || s.titre || '').split(' ')[0];
    return qui ? `${qui}, ${dateCourte(s.arrivee)}` : dateCourte(s.arrivee);
  }

  /** « 2 demandes », ou rien à traiter, plutôt qu'un zéro sec. */
  aTraiter(n: number): string {
    return n ? `${n} demande${n > 1 ? 's' : ''}` : 'Rien';
  }

  ouvrir(b: BienResume): void {
    this.etat.poserContexte(b.id);
    void this.router.navigate(['/']);
  }

  aller(lien: string): void { void this.router.navigate([lien]); }
}
