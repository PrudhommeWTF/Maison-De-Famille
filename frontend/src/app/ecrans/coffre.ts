// Le coffre-fort : documents versionnés et codes chiffrés.
//
// La maquette fixe la structure : deux colonnes, « Documents » à gauche avec la
// pastille de portée sur chaque ligne, « Codes & accès » à droite avec un
// bouton Afficher qui bascule les points en valeurs.
//
// **Une différence assumée avec le prototype.** Dans la maquette, « Afficher »
// dévoile tous les codes d'un coup, parce qu'un prototype n'a rien à protéger.
// Ici, chaque code se demande séparément, et cette demande part au serveur qui
// la journalise avec le nom de qui regarde. Dévoiler la liste entière d'un clic
// rendrait ce journal illisible : on ne saurait plus qui avait vraiment besoin
// du code du portail. L'apparence est celle de la maquette, le geste est unitaire.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Fichiers } from '../core/fichiers';
import { Etat } from '../core/etat';
import { horodatageLisible } from '../core/format';

type Portee = 'gerant' | 'detenteur' | 'membres' | 'sejour';

interface Doc {
  id: number; nom: string; portee: Portee; note: string;
  version: number | null; fichierId: string | null; mime: string | null;
  deposeLe: string | null; deposeParNom: string | null;
}
interface Code {
  id: number; libelle: string; portee: Portee; note: string;
  majLe: string | null; dernierAffichage: string | null;
}
interface Coffre {
  documents: Doc[]; codes: Code[]; coffreDisponible: boolean;
  portees: { cle: Portee; libelle: string }[]; peutDeposer: boolean;
}

@Component({
  selector: 'app-coffre',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Coffre-fort</h1>
        <p class="text-body-secondary mb-0">{{ sousTitre() }}</p>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (coffre(); as c) {
        <div class="row row-cols-1 row-cols-xl-2 g-3">
          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-center gap-3 mb-2">
                  <div class="eyebrow"><i class="bi bi-file-earmark-text me-2" aria-hidden="true"></i>Documents</div>
                  @if (c.peutDeposer) {
                    <label class="btn btn-sm btn-outline-secondary mb-0">
                      <i class="bi bi-upload me-1" aria-hidden="true"></i>Déposer
                      <input type="file" accept="image/*,application/pdf" hidden
                             (change)="choisirDocument($event)">
                    </label>
                  }
                </div>

                @if (depot()) {
                  <form class="row g-2 mb-3" (ngSubmit)="deposerDocument()">
                    <div class="col-12 col-md-6">
                      <label class="form-label small text-body-secondary" for="d-nom">Nom du document</label>
                      <input class="form-control" id="d-nom" name="dnom" [(ngModel)]="fNom"
                             placeholder="Convention d'indivision">
                    </div>
                    <div class="col-12 col-md-6">
                      <label class="form-label small text-body-secondary" for="d-por">Qui peut le voir</label>
                      <select class="form-select" id="d-por" name="dpor" [(ngModel)]="fPortee">
                        @for (p of c.portees; track p.cle) { <option [value]="p.cle">{{ p.libelle }}</option> }
                      </select>
                    </div>
                    <div class="col-12 d-flex gap-2 align-items-center">
                      <span class="text-body-secondary small flex-grow-1">{{ fFichierNom }}</span>
                      <button class="btn btn-sm btn-outline-secondary" type="button" (click)="annulerDepot()">Annuler</button>
                      <button class="btn btn-sm btn-primary" type="submit" [disabled]="occupe() || !fNom.trim()">
                        Déposer
                      </button>
                    </div>
                  </form>
                }

                @if (c.documents.length) {
                  <ul class="list-group list-group-flush">
                    @for (d of c.documents; track d.id) {
                      <li class="list-group-item d-flex align-items-center gap-3 px-0">
                        <span class="d-flex align-items-center justify-content-center bg-secondary-subtle border rounded-1
                                     text-body-secondary flex-shrink-0 fw-semibold"
                              style="width:32px;height:36px;font-size:.6rem">{{ extension(d) }}</span>
                        <span class="flex-grow-1" style="min-width:130px">
                          <span class="d-block small fw-medium">{{ d.nom }}</span>
                          <span class="d-block text-body-secondary" style="font-size:.72rem">
                            @if (d.deposeLe) {
                              Version {{ d.version }} · déposée le {{ horodatageLisible(d.deposeLe) }}
                              @if (d.deposeParNom) { par {{ d.deposeParNom }} }
                            } @else { Aucun fichier }
                          </span>
                        </span>
                        <span class="badge rounded-pill text-bg-light border fw-normal flex-shrink-0">
                          {{ libellePortee(d.portee) }}
                        </span>
                        @if (d.fichierId) {
                          <button class="btn btn-sm btn-outline-secondary flex-shrink-0" type="button"
                                  (click)="ouvrir(d)">Ouvrir</button>
                        }
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="text-body-secondary small mb-0">Aucun document visible pour vous.</p>
                }
              </div>
            </section>
          </div>

          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-center gap-3 mb-2">
                  <div class="eyebrow"><i class="bi bi-key me-2" aria-hidden="true"></i>Codes et accès</div>
                  @if (c.peutDeposer && c.coffreDisponible) {
                    <button class="btn btn-sm btn-outline-secondary" type="button"
                            (click)="saisieCode.set(!saisieCode())">
                      {{ saisieCode() ? 'Fermer' : 'Ajouter' }}
                    </button>
                  }
                </div>

                @if (!c.coffreDisponible) {
                  <div class="alert alert-primary small">
                    Le coffre-fort des codes est verrouillé : la clé MDF_CLE_COFFRE n'est pas configurée
                    sur le serveur. Les documents restent accessibles.
                  </div>
                }

                @if (saisieCode()) {
                  <form class="row g-2 mb-3" (ngSubmit)="ajouterCode()">
                    <div class="col-12 col-md-6">
                      <label class="form-label small text-body-secondary" for="c-lib">Intitulé</label>
                      <input class="form-control" id="c-lib" name="clib" [(ngModel)]="fCodeLibelle"
                             placeholder="Portail résidence">
                    </div>
                    <div class="col-12 col-md-6">
                      <label class="form-label small text-body-secondary" for="c-val">Code</label>
                      <input class="form-control" id="c-val" name="cval" [(ngModel)]="fCodeValeur" placeholder="1840B">
                    </div>
                    <div class="col-12 col-md-6">
                      <label class="form-label small text-body-secondary" for="c-por">Qui peut le voir</label>
                      <select class="form-select" id="c-por" name="cpor" [(ngModel)]="fCodePortee">
                        @for (p of c.portees; track p.cle) { <option [value]="p.cle">{{ p.libelle }}</option> }
                      </select>
                    </div>
                    <div class="col-12 col-md-6 d-flex align-items-end">
                      <button class="btn btn-primary w-100" type="submit"
                              [disabled]="occupe() || !fCodeLibelle.trim() || !fCodeValeur.trim()">
                        Enregistrer
                      </button>
                    </div>
                  </form>
                }

                @if (c.codes.length) {
                  <ul class="list-group list-group-flush">
                    @for (k of c.codes; track k.id) {
                      <li class="list-group-item px-0">
                        <div class="d-flex align-items-center gap-3 flex-wrap">
                          <span class="flex-grow-1" style="min-width:130px">
                            <span class="d-block small fw-medium">{{ k.libelle }}</span>
                            <span class="d-block text-body-secondary" style="font-size:.72rem">
                              {{ libellePortee(k.portee) }}
                              @if (k.dernierAffichage) { · vu le {{ horodatageLisible(k.dernierAffichage) }} }
                            </span>
                          </span>
                          @if (revele()[k.id]) {
                            <span class="font-monospace fw-medium">{{ revele()[k.id] }}</span>
                            <button class="btn btn-sm btn-link text-body-secondary p-0" type="button"
                                    (click)="masquer(k)">Masquer</button>
                          } @else {
                            <span class="font-monospace fw-medium" aria-hidden="true">• • • •</span>
                            <button class="btn btn-sm btn-outline-secondary" type="button"
                                    [disabled]="occupe()" (click)="afficher(k)">Afficher</button>
                          }
                          @if (c.peutDeposer) {
                            <button class="btn btn-sm btn-link text-body-secondary p-0" type="button"
                                    (click)="voirJournal(k)">Journal</button>
                          }
                        </div>

                        @if (journalDe() === k.id) {
                          <div class="text-body-secondary small mt-2">
                            <p class="mb-1">Qui a affiché ce code, et quand :</p>
                            @for (a of journal(); track $index) {
                              <div class="border-top py-1">{{ horodatageLisible(a.afficheLe) }} · {{ a.personneNom }}</div>
                            }
                            @if (!journal().length) { <div class="border-top py-1">Personne ne l'a encore affiché.</div> }
                          </div>
                        }
                      </li>
                    }
                  </ul>
                } @else if (c.coffreDisponible) {
                  <p class="text-body-secondary small mb-0">Aucun code visible pour vous.</p>
                }

                <p class="text-body-secondary small mt-3 mb-0">
                  Chiffré côté serveur. Chaque affichage est enregistré avec le nom de qui regarde et
                  l'heure. Un code de portée « pendant le séjour » se ferme le lendemain du départ.
                </p>
              </div>
            </section>
          </div>
        </div>
      }
    </div>
  `,
})
export class CoffreFort {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly fichiers = inject(Fichiers);
  readonly horodatageLisible = horodatageLisible;

  readonly coffre = signal<Coffre | null>(null);
  readonly revele = signal<Record<number, string>>({});
  readonly journalDe = signal<number | null>(null);
  readonly journal = signal<{ personneNom: string; afficheLe: string }[]>([]);
  readonly depot = signal(false);
  readonly saisieCode = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fNom = '';
  fPortee: Portee = 'detenteur';
  fFichierNom = '';
  private fFichier: File | null = null;
  fCodeLibelle = '';
  fCodeValeur = '';
  fCodePortee: Portee = 'sejour';

  readonly sousTitre = computed(() => {
    const c = this.coffre();
    if (!c) return 'Documents et codes du bien.';
    const compte = (n: number, un: string, plusieurs: string): string =>
      n === 0 ? `aucun ${un}` : `${n} ${n > 1 ? plusieurs : un}`;
    return `Vous voyez ${compte(c.documents.length, 'document', 'documents')} `
      + `et ${compte(c.codes.length, 'code', 'codes')}.`;
  });

  constructor() {
    effect(() => { const b = this.etat.bien(); if (b) void this.charger(b.id); });
  }

  readonly libellePortee = (p: Portee): string =>
    this.coffre()?.portees.find((x) => x.cle === p)?.libelle ?? p;

  /** L'extension affichée dans la pastille carrée, comme dans la maquette. */
  extension(d: Doc): string {
    if (!d.mime) return '...';
    if (d.mime === 'application/pdf') return 'PDF';
    return (d.mime.split('/')[1] ?? '').slice(0, 4).toUpperCase();
  }

  /** Télécharge la pièce jointe avec le jeton : la route ne sert rien sans lui. */
  ouvrir(d: Doc): Promise<void> {
    return d.fichierId ? this.fichiers.ouvrir(d.fichierId, d.nom) : Promise.resolve();
  }

  private async charger(bienId: number): Promise<void> {
    this.coffre.set(await this.api.get<Coffre>(`/biens/${bienId}/coffre`).catch(() => null));
    // Ce qui a été révélé ne le reste pas d'un bien à l'autre : le contexte
    // change, la valeur affichée doit disparaître avec lui.
    this.revele.set({});
    this.journalDe.set(null);
  }

  private async tenter(quoi: () => Promise<string>): Promise<void> {
    const b = this.etat.bien();
    if (!b || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.message.set(await quoi());
      await this.charger(b.id);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  /**
   * Afficher un code. L'appel part au serveur à chaque fois : c'est lui qui
   * vérifie la portée et journalise. Garder la valeur en mémoire côté navigateur
   * pour l'afficher deux fois sans le dire fausserait le journal.
   */
  async afficher(k: Code): Promise<void> {
    const b = this.etat.bien();
    if (!b || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    try {
      const r = await this.api.post<{ valeur: string }>(
        `/biens/${b.id}/coffre/codes/${k.id}/affichage`, {});
      this.revele.update((x) => ({ ...x, [k.id]: r.valeur }));
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "Ce code n'a pas pu être affiché.");
    } finally {
      this.occupe.set(false);
    }
  }

  masquer(k: Code): void {
    this.revele.update((x) => { const y = { ...x }; delete y[k.id]; return y; });
  }

  async voirJournal(k: Code): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    if (this.journalDe() === k.id) { this.journalDe.set(null); return; }
    this.journal.set(await this.api.get<{ personneNom: string; afficheLe: string }[]>(
      `/biens/${b.id}/coffre/codes/${k.id}/affichages`).catch(() => []));
    this.journalDe.set(k.id);
  }

  /** Le fichier part tel quel : le lire en base64 le gonflait d'un tiers, et
   *  un acte notarié scanné dépassait alors la taille acceptée par le serveur. */
  choisirDocument(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.fFichier = f;
    this.fFichierNom = f.name;
    if (!this.fNom) this.fNom = f.name.replace(/\.[^.]+$/, '');
    this.depot.set(true);
  }

  annulerDepot(): void {
    this.depot.set(false);
    this.fNom = '';
    this.fFichierNom = '';
    this.fFichier = null;
  }

  deposerDocument(): Promise<void> {
    const b = this.etat.bien();
    const fichier = this.fFichier;
    if (!b || !fichier) return Promise.resolve();
    return this.tenter(async () => {
      const f = await this.api.deposer<{ id: string }>(`/biens/${b.id}/coffre/fichier`, fichier);
      const nom = this.fNom.trim();
      await this.api.post(`/biens/${b.id}/coffre/documents`,
        { nom, portee: this.fPortee, fichierId: f.id, note: '' });
      this.annulerDepot();
      return `« ${nom} » déposé.`;
    });
  }

  ajouterCode(): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.tenter(async () => {
      const nom = this.fCodeLibelle.trim();
      await this.api.post(`/biens/${b.id}/coffre/codes`, {
        libelle: nom, valeur: this.fCodeValeur.trim(), portee: this.fCodePortee, note: '',
      });
      this.fCodeLibelle = '';
      this.fCodeValeur = '';
      this.saisieCode.set(false);
      return `Code « ${nom} » enregistré, chiffré côté serveur.`;
    });
  }
}
