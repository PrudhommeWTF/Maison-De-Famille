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
import { euros, nuitsLisible, personnesLisible, plage } from '../core/format';
import { etapes } from '../core/demarrage';
import type { Etape } from '../core/demarrage';
import type { BienResume, Etat as EtatSysteme, ListeDepenses, Sejour, Soldes } from '../core/modeles';

interface Gouvernance { alertes: { structureNom: string }[] }

@Component({
  selector: 'app-tableau-de-bord',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .cartes-biens { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
    .carte-bien { padding: 0; overflow: hidden; text-align: left; background: var(--surface);
                  border: 1px solid var(--bordure-carte); border-radius: 16px; width: 100%; font-family: inherit; }
    .bandeau { height: 110px; background: var(--actif); display: grid; place-items: center; color: var(--encre-3); }
    .bandeau i { font-size: 26px; }
    .corps { padding: 16px 18px 18px; }
    .nom-bien { font-family: var(--titre); font-size: 18px; font-weight: 500; }
    .stats { display: flex; gap: 22px; flex-wrap: wrap; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--separateur); }
    .stat .valeur { font-family: var(--titre); font-size: 20px; font-weight: 500; }
    .stat .quoi { font-size: 11.5px; color: var(--encre-3); }
    .trois { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .resume { display: flex; gap: 30px; flex-wrap: wrap; }
    .resume .valeur { font-family: var(--titre); font-size: 25px; font-weight: 500; }
    .acces-rapide { display: flex; gap: 8px; flex-wrap: wrap; }
    .plage { width: 78px; flex: none; font-size: 12px; color: var(--encre-3); }
    .demarrage { border-left: 3px solid var(--accent); }
    .etape { display: flex; gap: 12px; align-items: flex-start; padding: 12px 0; border-top: 1px solid var(--separateur); }
    .etape:first-of-type { border-top: none; }
    .etape .puce { width: 22px; height: 22px; flex: none; border-radius: 50%; display: grid; place-items: center;
                   background: var(--actif); color: var(--encre-3); font-size: 11px; margin-top: 2px; }
    .etape .puce.urgent { background: var(--accent); color: #fff; }
    .etape .quoi { flex: 1; min-width: 200px; }
    .etape .titre-e { font-size: 14px; display: block; }
    .etape .pourquoi { font-size: 12.5px; color: var(--encre-3); margin: 2px 0 0; }
  `],
  template: `
    <div class="colonne">
      @if (etat.bien(); as b) {
        <div>
          <h1>{{ b.nom }}</h1>
          <p class="secondaire" style="margin:6px 0 0">
            {{ b.commune }} · {{ b.couchages }} couchages ·
            @if (etat.demandesEnAttente() > 0) {
              {{ etat.demandesEnAttente() }} demande{{ etat.demandesEnAttente() > 1 ? 's' : '' }} en attente
            } @else { aucune demande en attente }
          </p>
        </div>

        @if (demarrage().length) {
          <section class="carte demarrage">
            <h2>Pour démarrer</h2>
            <p class="secondaire" style="margin:4px 0 10px">
              Ce qu'il reste à faire pour que la famille puisse s'en servir. Cette carte
              disparaît d'elle-même, étape par étape.
            </p>
            @for (e of demarrage(); track e.cle) {
              <div class="etape">
                <span class="puce" [class.urgent]="e.bloquante" aria-hidden="true">
                  <i class="bi" [class.bi-exclamation]="e.bloquante" [class.bi-arrow-right]="!e.bloquante"></i>
                </span>
                <span class="quoi">
                  <span class="titre-e">{{ e.titre }}</span>
                  <p class="pourquoi">{{ e.pourquoi }}</p>
                </span>
                @if (e.lien) {
                  <a class="btn" [routerLink]="e.lien">Y aller</a>
                }
              </div>
            }
          </section>
        }

        <div class="carte entre">
          <div class="resume">
            <div class="stat">
              <div class="valeur">{{ prochain() ? plage(prochain()!.arrivee, prochain()!.depart) : 'Aucun' }}</div>
              <div class="quoi">Prochain séjour</div>
            </div>
            <div class="stat">
              <div class="valeur chiffres">{{ nuitsAVenir() }}</div>
              <div class="quoi">Nuits réservées à venir</div>
            </div>
            <div class="stat">
              <div class="valeur chiffres">{{ etat.demandesEnAttente() }}</div>
              <div class="quoi">À traiter</div>
            </div>
          </div>
          <div class="acces-rapide">
            <a class="btn" routerLink="/bien/calendrier">Calendrier</a>
            <a class="btn" routerLink="/bien/demandes">Demandes</a>
            <a class="btn" routerLink="/bien/fiche">Fiche</a>
          </div>
        </div>
      } @else {
        <div>
          <h1>Bonjour {{ prenom() }}</h1>
          <p class="secondaire" style="margin:6px 0 0">
            @if (etat.biens().length) {
              Vos biens et ce qui vous attend. Choisissez un bien pour entrer dans son dossier.
            } @else {
              Aucun bien ne vous est rattaché pour l'instant. Le gérant peut vous ajouter.
            }
          </p>
        </div>

        @if (etat.biens().length) {
          <div class="grille cartes-biens">
            @for (b of etat.biens(); track b.id) {
              <button class="carte-bien carte-cliquable" (click)="ouvrir(b)">
                <div class="bandeau"><i class="bi" [class]="ico(b.type)" aria-hidden="true"></i></div>
                <div class="corps">
                  <div class="nom-bien">{{ b.nom }}</div>
                  <div class="meta" style="margin-top:2px">{{ b.commune }} · {{ b.couchages }} couchages</div>
                  <div style="margin-top:10px"><span class="pastille">{{ libelleStructure(b) }}</span></div>
                  <div class="stats">
                    <div class="stat">
                      <div class="valeur chiffres">{{ compteurs()[b.id]?.aVenir ?? 0 }}</div>
                      <div class="quoi">Séjours à venir</div>
                    </div>
                    <div class="stat">
                      <div class="valeur chiffres">{{ b.demandesEnAttente }}</div>
                      <div class="quoi">En attente</div>
                    </div>
                  </div>
                </div>
              </button>
            }
          </div>
        }
      }

      <div class="grille trois">
        <!-- Ce qui vous attend : agrège les demandes et les échéances, triées
             par date limite. Chaque ligne mène droit à l'écran concerné. -->
        <section class="carte">
          <h2>Ce qui vous attend</h2>
          @if (attentes().length) {
            <div style="margin-top:12px">
              @for (a of attentes(); track a.lien + a.titre) {
                <button class="ligne" (click)="aller(a.lien)">
                  <i class="bi" [class]="a.icone" aria-hidden="true" style="color:var(--accent)"></i>
                  <span>
                    <span style="display:block;font-size:13.5px">{{ a.titre }}</span>
                    <span class="meta">{{ a.sous }}</span>
                  </span>
                </button>
              }
            </div>
          } @else {
            <p class="vide">Rien à traiter pour le moment.</p>
          }
        </section>

        <section class="carte">
          <h2>Prochains séjours</h2>
          @if (aVenir().length) {
            <div style="margin-top:12px">
              @for (s of aVenir(); track s.id) {
                <div class="ligne">
                  <span class="plage chiffres">{{ plage(s.arrivee, s.depart) }}</span>
                  <span>
                    <span style="display:block;font-size:13.5px">{{ s.titre }}</span>
                    <span class="meta">{{ s.bienNom }} · {{ nuitsLisible(s.nuits) }}</span>
                  </span>
                </div>
              }
            </div>
          } @else {
            <p class="vide">Aucun séjour prévu.</p>
          }
        </section>

        <!-- La trésorerie. Le tableau de bord ne calcule rien : il compose ce
             que le module argent lui rend, et n'affiche la carte que s'il a
             quelque chose à dire. -->
        @if (tresorerie(); as t) {
          <section class="carte">
            <h2>{{ t.titre }}</h2>
            <div style="font-family:var(--titre);font-size:30px;font-weight:500;margin:10px 0 2px"
                 class="chiffres">{{ euros(t.montantCents) }}</div>
            <p class="meta" style="margin:0 0 12px">{{ t.sousTitre }}</p>
            @for (l of t.lignes; track l.cle) {
              <div class="ligne" style="justify-content:space-between">
                <span>{{ l.cle }}</span>
                <span class="chiffres">{{ l.valeur }}</span>
              </div>
            }
            <a class="btn" routerLink="/bien/soldes" style="margin-top:10px">Voir les soldes</a>
          </section>
        }

        @if (monSejour(); as s) {
          <section class="carte">
            <h2>Votre séjour</h2>
            <p class="secondaire" style="margin:10px 0 2px">{{ s.bienNom }}</p>
            <div style="font-family:var(--titre);font-size:20px">{{ plage(s.arrivee, s.depart) }}</div>
            <p class="meta" style="margin:4px 0 14px">
              {{ nuitsLisible(s.nuits) }} · {{ personnesLisible(s.occupants) }} ·
              {{ s.statut === 'valide' ? 'validé' : 'en attente de validation' }}
            </p>
            <a class="btn" routerLink="/bien/calendrier">Voir le calendrier</a>
          </section>
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
    return {
      titre: s ? `Trésorerie de ${s.structure.nom}` : 'Trésorerie',
      montantCents: d.total,
      sousTitre: `Dépenses engagées sur l'exercice ${d.annee}`,
      lignes: [
        { cle: 'À régulariser', valeur: euros(aRegulariser) },
        { cle: 'Virements proposés', valeur: String(s?.virements.length ?? 0) },
      ],
    };
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

  readonly compteurs = computed<Record<number, { aVenir: number }>>(() => {
    const out: Record<number, { aVenir: number }> = {};
    for (const s of this.sejours()) {
      out[s.bienId] = { aVenir: (out[s.bienId]?.aVenir ?? 0) + 1 };
    }
    return out;
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

  private async charger(): Promise<void> {
    const bien = this.etat.bien();
    const [sejours, demandes, depenses, soldes, echeances] = await Promise.all([
      this.api.get<Sejour[]>('/sejours/a-venir').catch(() => [] as Sejour[]),
      this.etat.estGerant() ? this.api.get<Sejour[]>('/demandes').catch(() => [] as Sejour[]) : Promise.resolve([]),
      this.etat.voitLArgent()
        ? this.api.get<ListeDepenses>(`/depenses${bien ? '?bienId=' + bien.id : ''}`).catch(() => null)
        : Promise.resolve(null),
      bien && this.etat.voitLArgent()
        ? this.api.get<Soldes>(`/structures/${bien.structureId}/soldes`).catch(() => null)
        : Promise.resolve(null),
      this.api.get<{ id: number; libelle: string; bienNom: string; echeance: string; urgence: string }[]>(
        '/entretien/echeances').catch(() => []),
    ]);
    this.echeances.set(echeances.filter((e) => e.urgence !== 'plus_tard'));
    this.sejours.set(sejours);
    this.demandes.set(demandes.filter((d) => this.etat.contexte() === TOUS || d.bienId === this.etat.contexte()));
    this.depenses.set(depenses);
    this.soldes.set(soldes);
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

  libelleStructure(b: BienResume): string {
    const mode = b.structureMode === 'sci' ? 'SCI' : b.structureMode === 'nom_propre' ? 'Nom propre' : 'Indivision';
    return `${mode} · ${b.structureNom}`;
  }

  ouvrir(b: BienResume): void {
    this.etat.poserContexte(b.id);
    void this.router.navigate(['/']);
  }

  aller(lien: string): void { void this.router.navigate([lien]); }
}
