// Décisions et votes.
//
// La maquette fixe la structure : la carte du vote ouvert avec sa barre de voix
// exprimées, les deux boutons Pour et Contre, la phrase qui dit ce qui manque,
// et l'historique en dessous, quatre colonnes : date, objet, majorité requise,
// résultat.
//
// **Ce que cet écran ne fait pas : calculer.** Le seuil, le décompte et le
// verdict viennent tous du serveur, où ils sont figés au dépouillement. Un
// écran qui recalculerait afficherait un autre chiffre le jour où la règle
// change, et une décision de 2026 doit se relire en 2032 telle qu'elle a été
// prise.
//
// **Une différence assumée avec le prototype.** La maquette ne propose que Pour
// et Contre. L'abstention existe ici comme choix explicite, à côté du silence,
// parce que les deux ne veulent pas dire la même chose : se prononcer pour
// l'abstention est une position, ne pas répondre est un oubli. Les deux comptent
// pareil au décompte, mais la gérante voit la différence, et le rappel avant
// clôture ne part qu'aux silencieux.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { dateLongue, euros } from '../core/format';

type Sens = 'pour' | 'contre' | 'abstention';

interface Regle {
  id: number; acte: string; libelle: string; base: 'parts' | 'tetes';
  seuilNum: number; seuilDen: number; voteRequis: boolean;
}
interface Depouillement {
  total: number; pour: number; contre: number; abstention: number; exprime: number;
  requis: number; quorumRequis: number | null; quorumAtteint: boolean;
  adopte: boolean; manque: number; explication: string;
}
interface ScrutinResume {
  id: number; titre: string; expose: string; montantCents: number | null;
  ouvertLe: string; clotureLe: string; statut: 'ouvert' | 'adopte' | 'rejete' | 'annule';
  convoqueLe: string | null; regle: string; resultat: Depouillement | null; creeParNom: string | null;
}
interface Liste {
  structure: { id: number; nom: string; mode: string };
  regles: Regle[];
  voteApplicable: boolean;
  scrutins: ScrutinResume[];
}
interface Vue {
  scrutin: ScrutinResume; regle: Regle;
  voix: { personneId: number; nom: string; poids: number; sens: Sens | null }[];
  depouillement: Depouillement;
  monSens: Sens | null; monPoids: number | null; phrase: string; issueCertaine: boolean;
}

const RESULTAT: Record<string, string> = {
  ouvert: 'En cours', adopte: 'Adopté', rejete: 'Rejeté', annule: 'Annulé',
};

@Component({
  selector: 'app-decisions',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .vote { border-left: 3px solid var(--accent); }
    .entete-vote { display: grid; grid-template-columns: 1fr 260px; gap: 24px; }
    .barre { display: flex; height: 9px; border-radius: 5px; overflow: hidden; background: var(--actif); margin: 8px 0 10px; }
    .barre span { display: block; height: 100%; }
    .part-pour { background: #7a8b5c; }
    .part-contre { background: #b0603f; }
    .legende { font-size: 12.5px; }
    .legende div { display: flex; justify-content: space-between; padding: 3px 0; }
    .seuil { font-size: 12px; color: var(--encre-3); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--separateur); }
    .choix { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 16px;
             padding-top: 14px; border-top: 1px solid var(--separateur); }
    .choix button { min-width: 108px; }
    .choix .pour.actif { border-color: #7a8b5c; color: #556340; }
    .choix .contre.actif { border-color: #b0603f; color: #8d4a2e; }
    .choix .abstention.actif { border-color: var(--encre-3); }
    .hint { font-size: 12.5px; color: var(--encre-3); flex: 1; min-width: 200px; }
    .histo { font-size: 13px; }
    .ligne-h { display: grid; grid-template-columns: 90px 1fr 190px 100px; gap: 12px; padding: 10px 0;
               border-top: 1px solid var(--separateur); align-items: center; }
    .ligne-h:first-of-type { border-top: none; }
    .pastille.adopte { background: #e4e9dc; color: #556340; }
    .pastille.rejete { background: #f0e0d5; color: #8d4a2e; }
    .detail { font-size: 12.5px; white-space: pre-wrap; background: var(--pastille-neutre);
              border-radius: 10px; padding: 12px 14px; margin-top: 10px; }
    .lien { border: none; background: none; padding: 0 0 0 8px; font: inherit; font-size: 12.5px;
            color: var(--encre-3); text-decoration: underline; cursor: pointer; }
    .lien:hover { color: var(--accent); }
    .saisie { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: end; }
    @media (max-width: 860px) {
      .entete-vote, .saisie { grid-template-columns: 1fr; }
      .ligne-h { grid-template-columns: 1fr; gap: 3px; }
    }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>Décisions &amp; votes</h1>
        <p class="secondaire" style="margin:6px 0 0">
          Les voix sont pondérées par les {{ etat.vocabulaire().parts }}, avec la majorité requise
          selon la nature de l'acte.
        </p>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      @if (liste(); as l) {
        @if (!l.voteApplicable) {
          <section class="carte">
            <p class="secondaire" style="margin:0 0 4px">{{ l.structure.nom }}</p>
            <h2>Aucun vote sur ce bien</h2>
            <p class="secondaire" style="margin:8px 0 0">
              Ce bien est détenu en nom propre : le propriétaire décide et invite les autres,
              sans scrutin. Les décisions prises se consignent quand même, pour mémoire.
            </p>
          </section>
        }

        @for (s of ouverts(); track s.id) {
          <article class="carte vote">
            <div class="entete-vote">
              <div>
                <div class="secondaire" style="font-size:12.5px">
                  Vote ouvert · clôture le {{ dateLongue(s.clotureLe) }}
                  @if (s.creeParNom) { · ouvert par {{ s.creeParNom }} }
                </div>
                <h2 style="margin:4px 0 2px">{{ s.titre }}</h2>
                <div class="secondaire" style="font-size:12.5px">
                  {{ l.structure.nom }} · {{ s.regle }}
                  @if (s.montantCents !== null) { · {{ euros(s.montantCents) }} }
                </div>
                @if (s.expose) { <p class="secondaire" style="margin:10px 0 0">{{ s.expose }}</p> }
              </div>

              @if (detail()[s.id]; as d) {
                <div>
                  <div class="secondaire" style="font-size:11.5px;letter-spacing:.08em;text-transform:uppercase">
                    Voix exprimées
                  </div>
                  <div class="barre" role="img"
                       [attr.aria-label]="'Pour ' + pct(d.depouillement.pour, d.depouillement.total)
                         + ', contre ' + pct(d.depouillement.contre, d.depouillement.total)">
                    <span class="part-pour" [style.width]="pct(d.depouillement.pour, d.depouillement.total)"></span>
                    <span class="part-contre" [style.width]="pct(d.depouillement.contre, d.depouillement.total)"></span>
                  </div>
                  <div class="legende">
                    <div><span>Pour</span><span>{{ pct(d.depouillement.pour, d.depouillement.total) }}</span></div>
                    <div><span>Contre</span><span>{{ pct(d.depouillement.contre, d.depouillement.total) }}</span></div>
                    <div><span>En attente</span><span>{{ pct(d.depouillement.abstention, d.depouillement.total) }}</span></div>
                  </div>
                  <div class="seuil">
                    Seuil à atteindre : {{ d.depouillement.requis }} sur {{ d.depouillement.total }}
                    ({{ pct(d.depouillement.requis, d.depouillement.total) }})
                  </div>
                </div>
              }
            </div>

            @if (detail()[s.id]; as d) {
              @if (d.monPoids !== null) {
                <div class="choix">
                  @for (c of CHOIX; track c.sens) {
                    <button class="btn" type="button" [class]="'btn ' + c.sens"
                            [class.actif]="d.monSens === c.sens" [disabled]="occupe()"
                            (click)="voter(s, c.sens)">
                      @if (d.monSens === c.sens) { <i class="bi bi-check2" aria-hidden="true"></i> }
                      {{ c.libelle }}
                    </button>
                  }
                  <span class="hint">{{ d.phrase }}</span>
                </div>
              } @else {
                <p class="secondaire" style="margin:14px 0 0;font-size:12.5px">
                  Vous ne faites pas partie du corps électoral de ce scrutin, figé à son ouverture.
                </p>
              }

              @if (etat.estGeranteIci()) {
                <div class="choix">
                  <button class="btn btn-primaire" type="button" [disabled]="occupe()"
                          (click)="depouiller(s)">Dépouiller et clore</button>
                  <button class="btn" type="button" [disabled]="occupe()" (click)="annuler(s)">Annuler</button>
                  <span class="hint">
                    @if (d.issueCertaine) {
                      Plus aucune voix ne peut changer le résultat : vous pouvez clore sans attendre.
                    } @else {
                      Clôture prévue le {{ dateLongue(s.clotureLe) }}.
                    }
                  </span>
                </div>
                <details style="margin-top:10px">
                  <summary class="secondaire" style="cursor:pointer;font-size:12.5px">
                    Qui a voté quoi
                  </summary>
                  <div class="histo" style="margin-top:8px">
                    @for (v of d.voix; track v.personneId) {
                      <div class="ligne-h" style="grid-template-columns:1fr 90px 110px">
                        <span>{{ v.nom }}</span>
                        <span class="chiffres">{{ v.poids }}</span>
                        <span class="pastille">{{ sensLisible(v.sens) }}</span>
                      </div>
                    }
                  </div>
                </details>
              }
            }
          </article>
        }

        @if (l.voteApplicable && etat.estGeranteIci()) {
          <section class="carte">
            <h2>Ouvrir un vote</h2>
            <form class="saisie" style="margin-top:12px" (ngSubmit)="ouvrir()">
              <div style="grid-column:1/-1">
                <label for="v-titre">Objet de la décision</label>
                <input id="v-titre" name="vtitre" [(ngModel)]="fTitre"
                       placeholder="Remplacement de la chaudière">
              </div>
              <div>
                <label for="v-regle">Nature de l'acte</label>
                <select id="v-regle" name="vregle" [(ngModel)]="fRegleId">
                  @for (g of l.regles; track g.id) {
                    @if (g.voteRequis) { <option [ngValue]="g.id">{{ g.libelle }}</option> }
                  }
                </select>
              </div>
              <div>
                <label for="v-cloture">Clôture le</label>
                <input id="v-cloture" name="vcloture" type="date" [(ngModel)]="fClotureLe" [min]="demain()">
              </div>
              <div>
                <label for="v-montant">Montant en jeu (euros, facultatif)</label>
                <input id="v-montant" name="vmontant" type="number" min="0" step="0.01" [(ngModel)]="fMontant">
              </div>
              <div>
                <label for="v-convoc">Convocation d'assemblée (facultatif)</label>
                <input id="v-convoc" name="vconvoc" type="date" [(ngModel)]="fConvoqueLe">
              </div>
              <div style="grid-column:1/-1">
                <label for="v-expose">Exposé</label>
                <textarea id="v-expose" name="vexpose" rows="3" [(ngModel)]="fExpose"
                          placeholder="Devis, contexte, ce que chacun doit savoir avant de se prononcer."></textarea>
              </div>
              <div style="grid-column:1/-1">
                <button class="btn btn-primaire" type="submit"
                        [disabled]="occupe() || !fTitre.trim() || !fClotureLe">
                  Ouvrir le vote
                </button>
                <span class="hint" style="margin-left:12px">
                  Le corps électoral est figé à l'ouverture, avec les {{ etat.vocabulaire().parts }}
                  en vigueur ce jour-là. Chaque électeur reçoit un courriel.
                </span>
              </div>
            </form>
          </section>
        }

        <section class="carte">
          <h2>Historique</h2>
          <div class="histo" style="margin-top:8px">
            @for (s of clos(); track s.id) {
              <div class="ligne-h">
                <span class="secondaire">{{ mois(s.ouvertLe) }}</span>
                <span>
                  {{ s.titre }}
                  @if (s.resultat) {
                    <button class="lien" type="button" (click)="basculerDetail(s.id)">
                      {{ montre()[s.id] ? 'masquer le détail' : 'voir le détail' }}
                    </button>
                  }
                </span>
                <span class="secondaire">{{ s.regle }}</span>
                <span class="pastille" [class.adopte]="s.statut === 'adopte'"
                      [class.rejete]="s.statut === 'rejete'">{{ resultat(s.statut) }}</span>
              </div>
              @if (montre()[s.id] && s.resultat) {
                <div class="detail">{{ s.resultat.explication }}</div>
              }
            }
          </div>
          @if (!clos().length) {
            <p class="secondaire" style="margin:8px 0 0">Aucune décision enregistrée.</p>
          }
        </section>
      }
    </div>
  `,
})
export class Decisions {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly dateLongue = dateLongue;
  readonly euros = euros;
  readonly CHOIX: { sens: Sens; libelle: string }[] = [
    { sens: 'pour', libelle: 'Pour' },
    { sens: 'contre', libelle: 'Contre' },
    { sens: 'abstention', libelle: 'Abstention' },
  ];

  readonly liste = signal<Liste | null>(null);
  readonly detail = signal<Record<number, Vue>>({});
  readonly montre = signal<Record<number, boolean>>({});
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fTitre = '';
  fRegleId = 0;
  fClotureLe = '';
  fMontant: number | null = null;
  fConvoqueLe = '';
  fExpose = '';

  readonly structureId = computed(() => this.etat.bien()?.structureId ?? 0);
  readonly ouverts = computed(() => (this.liste()?.scrutins ?? []).filter((s) => s.statut === 'ouvert'));
  readonly clos = computed(() => (this.liste()?.scrutins ?? []).filter((s) => s.statut !== 'ouvert'));

  readonly resultat = (s: string): string => RESULTAT[s] ?? s;
  readonly sensLisible = (s: Sens | null): string =>
    s === 'pour' ? 'Pour' : s === 'contre' ? 'Contre' : s === 'abstention' ? 'Abstention' : 'En attente';
  readonly demain = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  readonly mois = (iso: string): string => dateLongue(iso).split(' ').slice(1).join(' ');

  /** Le pourcentage sert la barre et la légende : une seule source, un seul arrondi. */
  readonly pct = (part: number, total: number): string =>
    total <= 0 ? '0 %' : `${Math.round((part * 1000) / total) / 10}`.replace('.', ',') + ' %';

  constructor() {
    effect(() => { const id = this.structureId(); if (id) void this.charger(id); });
  }

  private async charger(structureId: number): Promise<void> {
    const l = await this.api.get<Liste>(`/structures/${structureId}/decisions`).catch(() => null);
    this.liste.set(l);
    if (l && !this.fRegleId) {
      this.fRegleId = l.regles.find((g) => g.voteRequis)?.id ?? 0;
    }
    if (!this.fClotureLe) {
      this.fClotureLe = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    }
    // Le détail de chaque vote ouvert : c'est lui qui porte le décompte et la
    // voix de la personne qui regarde.
    const vues = await Promise.all((l?.scrutins ?? []).filter((s) => s.statut === 'ouvert')
      .map((s) => this.api.get<Vue>(`/scrutins/${s.id}`).catch(() => null)));
    const carte: Record<number, Vue> = {};
    for (const v of vues) if (v) carte[v.scrutin.id] = v;
    this.detail.set(carte);
  }

  private async tenter(quoi: () => Promise<string>): Promise<void> {
    const id = this.structureId();
    if (!id || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.message.set(await quoi());
      await this.charger(id);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  basculerDetail(id: number): void {
    this.montre.update((m) => ({ ...m, [id]: !m[id] }));
  }

  voter(s: ScrutinResume, sens: Sens): Promise<void> {
    return this.tenter(async () => {
      await this.api.post(`/scrutins/${s.id}/voix`, { sens });
      return `Votre voix est enregistrée : ${this.sensLisible(sens).toLowerCase()}. `
        + 'Vous pouvez la changer tant que le vote est ouvert.';
    });
  }

  ouvrir(): Promise<void> {
    if (!this.fTitre.trim() || !this.fClotureLe) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/structures/${this.structureId()}/decisions`, {
        regleId: this.fRegleId, titre: this.fTitre.trim(), expose: this.fExpose.trim(),
        montantCents: this.fMontant === null || this.fMontant === undefined
          ? null : Math.round(this.fMontant * 100),
        clotureLe: this.fClotureLe, convoqueLe: this.fConvoqueLe,
      });
      const titre = this.fTitre.trim();
      this.fTitre = '';
      this.fExpose = '';
      this.fMontant = null;
      this.fConvoqueLe = '';
      return `Vote « ${titre} » ouvert. Les électeurs sont prévenus par courriel.`;
    });
  }

  depouiller(s: ScrutinResume): Promise<void> {
    return this.tenter(async () => {
      const v = await this.api.post<Vue>(
        `/structures/${this.structureId()}/decisions/${s.id}/depouillement`, {});
      return v.depouillement.adopte
        ? `« ${s.titre} » est adopté.` : `« ${s.titre} » est rejeté.`;
    });
  }

  annuler(s: ScrutinResume): Promise<void> {
    return this.tenter(async () => {
      await this.api.post(`/structures/${this.structureId()}/decisions/${s.id}/annulation`, {});
      return `Vote « ${s.titre} » annulé.`;
    });
  }
}
