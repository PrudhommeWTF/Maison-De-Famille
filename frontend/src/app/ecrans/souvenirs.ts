// Souvenirs : les albums de photos et le livre d'or.
//
// La maquette est sobre : un titre d'album avec son nombre de photos et de
// contributeurs, une grille de vignettes, et sous la grille un mot sur les
// albums archivés par année et un bouton « Ouvrir le livre d'or ».
//
// Deux notes de comportement, reprises telles quelles :
//
//   - « Un album par séjour, créé automatiquement à la fin du séjour. »
//   - « Tout membre de foyer peut déposer des photos ; seul l'auteur ou la
//     gérante peut supprimer. »
//
// **Les images passent par le service de fichiers, pas par une adresse nue.**
// La route qui rend les octets exige un jeton, qu'une balise `img` n'envoie
// pas : `Fichiers.image()` va chercher le contenu comme n'importe quel appel et
// en fait une adresse locale. C'est aussi ce qui garantit qu'une photo reste
// derrière son contrôle d'autorisation, y compris si son adresse est copiée.
//
// **C'est la vignette qui s'affiche, jamais l'originale.** Elle est fabriquée
// une fois au dépôt, côté serveur. Un album de vingt photos de téléphone servi
// en pleine résolution représente cent méga-octets, et personne ne l'ouvre deux
// fois depuis le fond d'une vallée.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { Fichiers } from '../core/fichiers';
import { aujourdhui, horodatageLisible } from '../core/format';

interface Album {
  id: number; bienId: number; sejourId: number | null; titre: string; annee: number;
  photos: number; couvertureId: string | null;
}
interface Mot {
  id: number; annee: number; texte: string; signature: string;
  ecritLe: string; ecritParNom: string | null;
}
interface Photo {
  id: number; albumId: number; fichierId: string; vignetteId: string | null;
  legende: string; deposeLe: string; deposePar: number | null; deposeParNom: string | null;
}
interface Vue { albums: Album[]; mots: Mot[] }

@Component({
  selector: 'app-souvenirs',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* Ce que Bootstrap ne porte pas : le remplissage d'une image dans son
       cadre, la légende posée sur la photo, et la zone de dépôt en tirets. */
    .vignette img, .couverture img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .legende {
      position: absolute; left: 0; right: 0; bottom: 0; padding: 7px 9px;
      font-size: .72rem; color: #fff; background: linear-gradient(transparent, rgba(0, 0, 0, .62));
    }
    .depot { border-style: dashed; cursor: pointer; }
    .depot:hover { border-color: var(--bs-primary); color: var(--bs-primary); }
  `],
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Souvenirs</h1>
        <p class="text-body-secondary mb-0">
          Un album par séjour, alimenté par la famille. Rien ne sort de cette instance.
        </p>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (vue(); as v) {
        @if (ouvert(); as a) {
          <section class="card">
            <div class="card-body">
              <button class="btn btn-sm btn-link text-body-secondary p-0" type="button" (click)="fermer()">
                <i class="bi bi-chevron-left me-1" aria-hidden="true"></i>Tous les albums
              </button>
              <h2 class="h5 card-title mt-2 mb-1">{{ a.titre }}</h2>
              <div class="text-body-secondary small">{{ metaAlbum() }}</div>

              <div class="row row-cols-2 row-cols-md-3 row-cols-xl-4 g-3 mt-1">
                <div class="col">
                  <label class="ratio ratio-4x3 rounded-3 border depot d-block">
                    <span class="d-flex flex-column align-items-center justify-content-center gap-2
                                 text-body-secondary small">
                      <i class="bi bi-plus-lg" aria-hidden="true"></i>
                      {{ occupe() ? 'Envoi en cours...' : 'Déposer une photo' }}
                    </span>
                    <input type="file" accept="image/*" multiple (change)="deposer($event)"
                           [disabled]="occupe()" hidden>
                  </label>
                </div>
                @for (p of photos(); track p.id) {
                  <div class="col">
                    <figure class="ratio ratio-4x3 rounded-3 overflow-hidden bg-body-tertiary vignette mb-0">
                      @if (fichiers.image(p.vignetteId ?? p.fichierId)(); as src) {
                        <img [src]="src" [alt]="p.legende || 'Photo déposée par ' + (p.deposeParNom ?? 'la famille')">
                      } @else {
                        <span class="d-flex align-items-center justify-content-center text-body-secondary">
                          <i class="bi bi-image" aria-hidden="true"></i>
                        </span>
                      }
                      @if (p.legende) { <figcaption class="legende">{{ p.legende }}</figcaption> }
                      @if (peutRetirer(p)) {
                        <span class="d-flex align-items-start justify-content-end p-2" style="pointer-events:none">
                          <button class="btn btn-sm btn-light border" type="button" [disabled]="occupe()"
                                  style="pointer-events:auto"
                                  [attr.aria-label]="'Retirer la photo de ' + (p.deposeParNom ?? 'la famille')"
                                  (click)="retirer(p)">
                            <i class="bi bi-x-lg" aria-hidden="true"></i>
                          </button>
                        </span>
                      }
                    </figure>
                  </div>
                }
              </div>
              @if (!photos().length) {
                <p class="text-body-secondary small mt-3 mb-0">
                  Cet album est vide. Les photos déposées ici restent sur votre serveur.
                </p>
              }
            </div>
          </section>
        } @else {
          <section class="card">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap">
                <div class="eyebrow">Albums</div>
                <button class="btn btn-sm btn-outline-secondary" type="button" (click)="creation.set(!creation())">
                  {{ creation() ? 'Fermer' : 'Nouvel album' }}
                </button>
              </div>

              @if (creation()) {
                <form class="row g-3 mt-0" (ngSubmit)="creer()">
                  <div class="col-12 col-md-6">
                    <label class="form-label small text-body-secondary" for="a-titre">Titre</label>
                    <input class="form-control" id="a-titre" name="atitre" [(ngModel)]="fTitre"
                           placeholder="Été à la maison">
                  </div>
                  <div class="col-12 col-md-3">
                    <label class="form-label small text-body-secondary" for="a-annee">Année</label>
                    <input class="form-control" id="a-annee" name="aannee" type="number" min="1900" max="2200"
                           [(ngModel)]="fAnnee">
                  </div>
                  <div class="col-12">
                    <button class="btn btn-primary" type="submit" [disabled]="occupe() || !fTitre.trim()">
                      Créer l'album
                    </button>
                  </div>
                </form>
              }

              @if (v.albums.length) {
                <div class="row row-cols-2 row-cols-md-3 row-cols-xl-4 g-3 mt-1">
                  @for (a of v.albums; track a.id) {
                    <div class="col">
                      <button class="card h-100 w-100 overflow-hidden text-start p-0 border" type="button"
                              (click)="ouvrirAlbum(a)">
                        <span class="ratio ratio-4x3 bg-body-tertiary couverture d-block">
                          @if (fichiers.image(a.couvertureId)(); as src) {
                            <img [src]="src" alt="">
                          } @else {
                            <span class="d-flex align-items-center justify-content-center text-body-secondary fs-4">
                              <i class="bi bi-images" aria-hidden="true"></i>
                            </span>
                          }
                        </span>
                        <span class="card-body">
                          <span class="d-block small fw-medium card-title">{{ a.titre }}</span>
                          <span class="d-block text-body-secondary" style="font-size:.72rem">
                            {{ a.annee }} · {{ a.photos }} photo{{ a.photos > 1 ? 's' : '' }}
                          </span>
                        </span>
                      </button>
                    </div>
                  }
                </div>
              } @else {
                <p class="text-body-secondary small mt-3 mb-0">
                  Aucun album pour l'instant. Un album se crée tout seul à la fin de chaque séjour,
                  et vous pouvez en ouvrir un dès maintenant.
                </p>
              }
            </div>
          </section>
        }

        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2"><i class="bi bi-journal-text me-2" aria-hidden="true"></i>Livre d'or</div>
            <p class="text-body-secondary small">
              Les mots laissés à chaque fin de séjour, du plus récent au plus ancien.
            </p>
            <form class="row g-3" (ngSubmit)="ecrire()">
              <div class="col-12">
                <label class="form-label small text-body-secondary" for="m-texte">Votre mot</label>
                <textarea class="form-control" id="m-texte" name="mtexte" rows="3" [(ngModel)]="fTexte"
                          placeholder="Une semaine de pluie et de cartes, et personne n'a voulu repartir."></textarea>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label small text-body-secondary" for="m-sign">Signature</label>
                <input class="form-control" id="m-sign" name="msign" [(ngModel)]="fSignature"
                       placeholder="Les Berger, août 2026">
              </div>
              <div class="col-12 col-md-6 d-flex align-items-end">
                <button class="btn btn-primary" type="submit" [disabled]="occupe() || !fTexte.trim()">
                  Laisser un mot
                </button>
              </div>
            </form>

            @if (v.mots.length) {
              <ul class="list-group list-group-flush mt-3">
                @for (m of v.mots; track m.id) {
                  <li class="list-group-item px-0">
                    <div class="small" style="white-space:pre-wrap">{{ m.texte }}</div>
                    <div class="text-body-secondary mt-1" style="font-size:.72rem">
                      {{ m.signature || m.ecritParNom }} · {{ horodatageLisible(m.ecritLe) }}
                    </div>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-body-secondary small mt-3 mb-0">Le livre d'or est encore vierge.</p>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class Souvenirs {
  readonly etat = inject(Etat);
  readonly fichiers = inject(Fichiers);
  private readonly api = inject(Api);
  readonly horodatageLisible = horodatageLisible;

  readonly vue = signal<Vue | null>(null);
  readonly ouvert = signal<Album | null>(null);
  readonly photos = signal<Photo[]>([]);
  readonly creation = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fTitre = '';
  fAnnee = Number(aujourdhui().slice(0, 4));
  fTexte = '';
  fSignature = '';

  readonly bienId = computed(() => this.etat.bien()?.id ?? 0);

  /** « 148 photos, 6 contributeurs » de la maquette, compté sur les photos lues. */
  readonly metaAlbum = computed(() => {
    const p = this.photos();
    const gens = new Set(p.map((x) => x.deposeParNom ?? '')).size;
    return `${p.length} photo${p.length > 1 ? 's' : ''}`
      + (gens ? ` · ${gens} contributeur${gens > 1 ? 's' : ''}` : '');
  });

  constructor() {
    effect(() => { const id = this.bienId(); if (id) void this.charger(id); });
  }

  /** « Seul l'auteur ou la gérante peut supprimer. » Le serveur le vérifie aussi. */
  peutRetirer(p: Photo): boolean {
    return this.etat.estGeranteIci() || p.deposePar === this.etat.moi()?.personne.id;
  }

  private async charger(bienId: number): Promise<void> {
    this.vue.set(await this.api.get<Vue>(`/biens/${bienId}/albums`).catch(() => null));
    const a = this.ouvert();
    if (a) await this.chargerPhotos(bienId, a.id);
  }

  private async chargerPhotos(bienId: number, albumId: number): Promise<void> {
    this.photos.set(await this.api.get<Photo[]>(`/biens/${bienId}/albums/${albumId}`).catch(() => []));
  }

  async ouvrirAlbum(a: Album): Promise<void> {
    this.ouvert.set(a);
    this.photos.set([]);
    await this.chargerPhotos(this.bienId(), a.id);
  }

  fermer(): void {
    this.ouvert.set(null);
    this.photos.set([]);
  }

  private async tenter(quoi: () => Promise<string>): Promise<void> {
    const id = this.bienId();
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

  creer(): Promise<void> {
    if (!this.fTitre.trim()) return Promise.resolve();
    return this.tenter(async () => {
      const titre = this.fTitre.trim();
      await this.api.post(`/biens/${this.bienId()}/albums`, { titre, annee: this.fAnnee });
      this.fTitre = '';
      this.creation.set(false);
      return `Album « ${titre} » créé.`;
    });
  }

  /**
   * Dépose les photos choisies, une par une.
   *
   * En série et non en parallèle : dix photos de huit méga-octets envoyées
   * ensemble depuis un téléphone en 4G saturent la liaison et échouent toutes.
   * Une à la fois, la plus lente n'empêche pas les autres d'arriver.
   */
  deposer(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const fichiers = Array.from(input.files ?? []);
    const album = this.ouvert();
    input.value = '';
    if (!album || !fichiers.length) return Promise.resolve();
    return this.tenter(async () => {
      let deposees = 0;
      let refus = '';
      for (const f of fichiers) {
        try {
          await this.api.deposer(`/biens/${this.bienId()}/albums/${album.id}/photos`, f);
          deposees++;
        } catch (err) {
          refus = err instanceof ErreurAppel ? `${f.name} : ${err.message}` : `${f.name} n'a pas pu être déposée.`;
        }
      }
      await this.chargerPhotos(this.bienId(), album.id);
      if (!deposees) throw new Error(refus);
      return `${deposees} photo${deposees > 1 ? 's déposées' : ' déposée'}.`
        + (refus ? ` Une n'est pas passée : ${refus}` : '');
    });
  }

  retirer(p: Photo): Promise<void> {
    return this.tenter(async () => {
      await this.api.post(`/biens/${this.bienId()}/albums/photos/${p.id}/archivage`, {});
      const a = this.ouvert();
      if (a) await this.chargerPhotos(this.bienId(), a.id);
      return 'Photo retirée de l\'album.';
    });
  }

  ecrire(): Promise<void> {
    if (!this.fTexte.trim()) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${this.bienId()}/livre-or`, {
        texte: this.fTexte.trim(), signature: this.fSignature.trim(), annee: this.fAnnee,
      });
      this.fTexte = '';
      return 'Votre mot est dans le livre d\'or.';
    });
  }
}
