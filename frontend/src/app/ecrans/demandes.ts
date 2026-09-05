// La file d'attente et le tour de choix.
//
// Deux onglets, comme dans la maquette. Le premier est le coeur du travail de la
// gérante : une carte par demande, avec ses conflits sous les yeux et deux
// boutons. Le second documente l'équité de la haute saison, sans l'imposer.
//
// **L'application propose, elle ne valide pas à sa place.** Un conflit ne bloque
// aucun bouton, il s'affiche. Une décision est réversible et horodatée.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { dateLongue, horodatageLisible, nuitsLisible, personnesLisible, plage } from '../core/format';
import type { Demande, Saison } from '../core/modeles';

interface Arbitrage {
  attributions: { voeuId: number; foyerId: number; du: string; au: string; rang: number }[];
  refus: { voeuId: number; foyerId: number; du: string; au: string; raison: string }[];
  bilan: { foyerId: number; foyerNom: string; nuits: number; quota: number | null; depassement: number }[];
  depassements: { foyerId: number; depassement: number }[];
}

@Component({
  selector: 'app-demandes',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .onglets { display: inline-flex; gap: 3px; padding: 3px; background: #e9e2d7; border-radius: 20px; }
    .onglets button {
      border: none; background: transparent; border-radius: 20px; padding: 7px 15px; min-height: 36px;
      font-family: inherit; font-size: 13px; color: var(--encre-2); cursor: pointer;
    }
    .onglets button[aria-selected="true"] { background: var(--surface); box-shadow: 0 1px 2px rgba(36,32,27,.08); }
    .demande { display: flex; gap: 20px; justify-content: space-between; flex-wrap: wrap; }
    .demande .infos { flex: 1; min-width: 240px; }
    .demande .actions { display: flex; flex-direction: column; gap: 8px; min-width: 190px; }
    .tableau { display: grid; gap: 6px; }
    .tableau .entete, .tableau .ligne-t {
      display: grid; grid-template-columns: minmax(140px, 1.1fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(90px, .7fr);
      gap: 10px; align-items: center;
    }
    .tableau .entete { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--libelle-section); }
    .tableau .ligne-t { padding: 9px 0; border-top: 1px solid var(--separateur); font-size: 13px; }
    @media (max-width: 700px) {
      .demande .actions { min-width: 0; width: 100%; }
      .tableau .entete { display: none; }
      .tableau .ligne-t { grid-template-columns: 1fr; gap: 3px; }
    }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>Demandes de séjour</h1>
        <p class="secondaire" style="margin:6px 0 0">
          {{ etat.bien()?.nom }} ·
          @if (file().length) { {{ file().length }} à traiter } @else { rien à traiter }
        </p>
      </div>

      <div class="onglets" role="tablist">
        <button role="tab" [attr.aria-selected]="onglet() === 'file'" (click)="onglet.set('file')">File d'attente</button>
        <button role="tab" [attr.aria-selected]="onglet() === 'tour'" (click)="onglet.set('tour')">Tour de choix</button>
      </div>

      @if (message()) { <div class="encart-positif">{{ message() }}</div> }
      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }

      @if (onglet() === 'file') {
        @if (!etat.estGeranteIci()) {
          <div class="carte"><p class="vide">Seule la gérante arbitre les demandes. Les vôtres apparaissent dans le calendrier.</p></div>
        } @else if (file().length) {
          @for (d of file(); track d.id) {
            <section class="carte demande">
              <div class="infos">
                <h2>{{ d.titre }}</h2>
                <p class="secondaire" style="margin:4px 0 0">
                  {{ d.bienNom }} · {{ plage(d.arrivee, d.depart) }} ·
                  {{ nuitsLisible(d.nuits) }} · {{ personnesLisible(d.occupants) }}
                </p>
                <p class="meta" style="margin:2px 0 0">Demandé le {{ horodatageLisible(d.creeLe) }}</p>
                @if (d.note) { <p class="secondaire" style="margin:10px 0 0;font-style:italic">« {{ d.note }} »</p> }
                @if (d.conflits.length) {
                  <div class="encart" style="margin-top:12px">
                    @for (c of d.conflits; track c.message) { <div>{{ c.message }}</div> }
                  </div>
                }
              </div>
              <div class="actions">
                <button class="btn btn-primaire" (click)="decider(d, 'valide')" [disabled]="occupe()">Valider le séjour</button>
                <button class="btn" (click)="ouvrirRenvoi(d)" [disabled]="occupe()">Proposer d'autres dates</button>
                @if (renvoi() === d.id) {
                  <div class="champ" style="margin:0">
                    <label [attr.for]="'note-' + d.id">Message pour {{ d.titre }}</label>
                    <textarea [attr.id]="'note-' + d.id" name="note" [(ngModel)]="noteRenvoi"
                              placeholder="Peux-tu décaler au 9 ? Les locataires partent dans la journée."></textarea>
                    <button class="btn" style="margin-top:8px" (click)="decider(d, 'a_revoir')" [disabled]="occupe()">
                      Renvoyer la demande
                    </button>
                  </div>
                }
              </div>
            </section>
          }
        } @else {
          <div class="carte"><p class="vide">Aucune demande en attente sur ce bien.</p></div>
        }
      }

      @if (onglet() === 'tour') {
        @if (saisons().length) {
          @for (s of saisons(); track s.saison.id) {
            <section class="carte">
              <div class="entre">
                <div>
                  <h2>{{ s.saison.libelle }}</h2>
                  <p class="meta" style="margin:4px 0 0">
                    Du {{ dateLongue(s.saison.debut) }} au {{ dateLongue(s.saison.fin) }} ·
                    {{ s.saison.statut === 'ouverte' ? 'voeux ouverts' : s.saison.statut === 'arbitree' ? 'arbitrée' : 'close' }}
                  </p>
                </div>
                @if (etat.estGeranteIci() && s.saison.statut === 'ouverte') {
                  <button class="btn btn-primaire" (click)="arbitrer(s)" [disabled]="occupe() || !s.voeux.length">
                    Lancer l'arbitrage
                  </button>
                }
              </div>

              <div class="tableau" style="margin-top:16px">
                <div class="entete">
                  <span>Foyer</span><span>1er choix</span><span>2e choix</span><span>Quota</span>
                </div>
                @for (f of foyersDe(s); track f.foyerId) {
                  <div class="ligne-t">
                    <span>{{ f.foyerNom }}</span>
                    <span class="chiffres">{{ f.choix1 || '—' }}</span>
                    <span class="chiffres">{{ f.choix2 || '—' }}</span>
                    <span class="chiffres">{{ f.quota === null ? '—' : nuitsLisible(f.quota) }}</span>
                  </div>
                }
                @if (!s.voeux.length) { <p class="vide">Aucun voeu déposé pour l'instant.</p> }
              </div>

              @if (voeuxOuverts(s)) {
                <div class="separateur" style="margin:16px 0 14px"></div>
                <h3>Déposer votre voeu</h3>
                <form (ngSubmit)="deposerVoeu(s)" style="margin-top:10px">
                  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
                    <div class="champ">
                      <label [attr.for]="'v-rang-' + s.saison.id">Choix</label>
                      <select [attr.id]="'v-rang-' + s.saison.id" name="rang" [(ngModel)]="voeu.rang">
                        <option [value]="1">Premier choix</option>
                        <option [value]="2">Second choix</option>
                      </select>
                    </div>
                    <div class="champ">
                      <label [attr.for]="'v-du-' + s.saison.id">Du</label>
                      <input [attr.id]="'v-du-' + s.saison.id" name="du" type="date" [(ngModel)]="voeu.du" required>
                    </div>
                    <div class="champ">
                      <label [attr.for]="'v-au-' + s.saison.id">Au</label>
                      <input [attr.id]="'v-au-' + s.saison.id" name="au" type="date" [(ngModel)]="voeu.au" required>
                    </div>
                    <div class="champ">
                      <label [attr.for]="'v-occ-' + s.saison.id">Personnes</label>
                      <input [attr.id]="'v-occ-' + s.saison.id" name="occupants" type="number" min="1" max="60" [(ngModel)]="voeu.occupants">
                    </div>
                  </div>
                  <button class="btn" type="submit" [disabled]="occupe()">Enregistrer mon voeu</button>
                </form>
              }

              @if (resultat() && resultat()!.saisonId === s.saison.id) {
                <div class="separateur" style="margin:16px 0 14px"></div>
                <h3>Résultat proposé</h3>
                <p class="secondaire" style="margin:6px 0 12px">
                  Ces séjours sont créés <strong>en attente</strong> : validez-les un par un dans la file,
                  et modifiez ce qui doit l'être. La décision finale reste la vôtre.
                </p>
                @for (b of resultat()!.arbitrage.bilan; track b.foyerId) {
                  <div class="ligne">
                    <span style="flex:1">{{ b.foyerNom }}</span>
                    <span class="chiffres">{{ nuitsLisible(b.nuits) }}</span>
                    @if (b.depassement > 0) {
                      <span class="pastille pastille-accent">quota dépassé de {{ b.depassement }}</span>
                    }
                  </div>
                }
                @for (r of resultat()!.arbitrage.refus; track r.voeuId) {
                  <div class="encart" style="margin-top:10px">{{ r.raison }}</div>
                }
              }
            </section>
          }
        } @else {
          <section class="carte">
            <h2>Tour de choix</h2>
            <p class="secondaire" style="margin:8px 0 14px">
              Le tour de choix sert à documenter l'équité de la haute saison : chacun dépose ses voeux,
              l'ordre de priorité tourne d'une année sur l'autre, et la gérante arbitre. Aucun algorithme
              ne décide à sa place.
            </p>
            @if (etat.estGeranteIci()) {
              <form (ngSubmit)="creerSaison()">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
                  <div class="champ">
                    <label for="s-lib">Libellé</label>
                    <input id="s-lib" name="libelle" [(ngModel)]="saison.libelle" placeholder="Été 2026" required>
                  </div>
                  <div class="champ">
                    <label for="s-debut">Début</label>
                    <input id="s-debut" name="debut" type="date" [(ngModel)]="saison.debut" required>
                  </div>
                  <div class="champ">
                    <label for="s-fin">Fin</label>
                    <input id="s-fin" name="fin" type="date" [(ngModel)]="saison.fin" required>
                  </div>
                </div>
                <button class="btn btn-primaire" type="submit" [disabled]="occupe()">Ouvrir une saison</button>
              </form>
            } @else {
              <p class="vide">Aucune saison ouverte pour l'instant.</p>
            }
          </section>
        }
      }
    </div>
  `,
})
export class Demandes {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly plage = plage;
  readonly dateLongue = dateLongue;
  readonly horodatageLisible = horodatageLisible;
  readonly nuitsLisible = nuitsLisible;
  readonly personnesLisible = personnesLisible;

  readonly onglet = signal<'file' | 'tour'>('file');
  private readonly demandes = signal<Demande[]>([]);
  readonly saisons = signal<Saison[]>([]);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');
  readonly renvoi = signal<number | null>(null);
  readonly resultat = signal<{ saisonId: number; arbitrage: Arbitrage } | null>(null);

  noteRenvoi = '';
  voeu = { rang: 1, du: '', au: '', occupants: 2 };
  saison = { libelle: '', debut: '', fin: '' };

  /** La file, filtrée sur le bien courant : le badge et cet écran comptent pareil. */
  readonly file = computed(() => this.demandes().filter((d) => d.bienId === this.etat.bien()?.id));

  constructor() {
    effect(() => { const b = this.etat.bien(); if (b) void this.charger(b.id); });
  }

  private async charger(bienId: number): Promise<void> {
    const [demandes, saisons] = await Promise.all([
      this.etat.estGeranteIci() ? this.api.get<Demande[]>('/demandes').catch(() => [] as Demande[]) : Promise.resolve([]),
      this.api.get<Saison[]>(`/biens/${bienId}/saisons`).catch(() => [] as Saison[]),
    ]);
    this.demandes.set(demandes);
    this.saisons.set(saisons);
  }

  ouvrirRenvoi(d: Demande): void {
    this.renvoi.set(this.renvoi() === d.id ? null : d.id);
    this.noteRenvoi = '';
  }

  async decider(d: Demande, statut: 'valide' | 'a_revoir'): Promise<void> {
    await this.agir(async () => {
      const r = await this.api.post<{ conflits: { message: string }[] }>(
        `/biens/${d.bienId}/sejours/${d.id}/decision`,
        { statut, note: statut === 'a_revoir' ? this.noteRenvoi : '' });
      this.renvoi.set(null);
      this.message.set(statut === 'valide'
        ? `Séjour de ${d.titre} validé.${r.conflits.length ? ' Le chevauchement a été enregistré dans le journal.' : ''} Un courriel lui a été envoyé.`
        : `Demande de ${d.titre} renvoyée avec votre message.`);
      await this.charger(d.bienId);
      await this.etat.rafraichir();
    });
  }

  async creerSaison(): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    await this.agir(async () => {
      await this.api.post(`/biens/${b.id}/saisons`, this.saison);
      this.saison = { libelle: '', debut: '', fin: '' };
      await this.charger(b.id);
    });
  }

  async deposerVoeu(s: Saison): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    await this.agir(async () => {
      await this.api.post(`/biens/${b.id}/saisons/${s.saison.id}/voeux`, {
        rang: Number(this.voeu.rang), du: this.voeu.du, au: this.voeu.au, occupants: Number(this.voeu.occupants),
      });
      this.message.set('Votre voeu est enregistré.');
      await this.charger(b.id);
    });
  }

  async arbitrer(s: Saison): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    await this.agir(async () => {
      const r = await this.api.post<Arbitrage>(`/biens/${b.id}/saisons/${s.saison.id}/arbitrage`);
      this.resultat.set({ saisonId: s.saison.id, arbitrage: r });
      this.message.set(`${r.attributions.length} séjour(s) proposé(s), à valider dans la file d'attente.`);
      await this.charger(b.id);
      await this.etat.rafraichir();
    });
  }

  /** Les lignes du tableau des voeux : un foyer par ligne, ses deux choix. */
  foyersDe(s: Saison): { foyerId: number; foyerNom: string; choix1: string; choix2: string; quota: number | null }[] {
    const ids = [...new Set(s.voeux.map((v) => v.foyerId))];
    return ids.map((foyerId) => {
      const siens = s.voeux.filter((v) => v.foyerId === foyerId);
      const c1 = siens.find((v) => v.rang === 1);
      const c2 = siens.find((v) => v.rang === 2);
      return {
        foyerId,
        foyerNom: siens[0]?.foyerNom ?? '',
        choix1: c1 ? plage(c1.du, c1.au) : '',
        choix2: c2 ? plage(c2.du, c2.au) : '',
        quota: s.quotas.find((q) => q.foyerId === foyerId)?.nuitsMax ?? null,
      };
    });
  }

  /**
   * Le formulaire de voeu n'apparaît que si la saison est ouverte et que la
   * personne appartient à un foyer : sans foyer, le serveur refuserait, et
   * afficher un formulaire qui échoue toujours ne rend service à personne.
   */
  voeuxOuverts(s: Saison): boolean {
    return s.saison.statut === 'ouverte' && !!this.etat.moi()?.personne.foyerId;
  }

  private async agir(action: () => Promise<void>): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try { await action(); }
    catch (e) { this.erreur.set(e instanceof ErreurAppel ? e.message : "L'action a échoué."); }
    finally { this.occupe.set(false); }
  }
}
