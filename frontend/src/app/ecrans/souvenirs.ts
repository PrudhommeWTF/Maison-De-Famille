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
    /* auto-fill et non auto-fit : avec un seul album, auto-fit étirait sa carte
       sur toute la largeur de l'écran, ce qui n'a aucun sens pour une vignette.
       Les colonnes vides gardent la grille en place. */
    .albums { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }
    /* Un bouton reste en ligne par défaut : sans display block, la légende
       passait sous le bord arrondi de la carte et se retrouvait coupée. */
    .album { display: block; text-align: left; padding: 0; overflow: hidden; }
    .couverture { display: flex; width: 100%; height: 122px; background: var(--pastille-neutre);
                  align-items: center; justify-content: center; color: var(--encre-3); }
    .couverture img { width: 100%; height: 100%; object-fit: cover; display: block; }
    /* Un span reste en ligne, et sa marge verticale ne pousse rien : sans
       display block, la légende dépassait du bas de la carte. */
    .album .dessous { display: block; padding: 12px 14px; }
    .album .titre { font: 500 15px 'Bricolage Grotesque', sans-serif; }
    .grille { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px; }
    .vignette { position: relative; border-radius: 12px; overflow: hidden; background: var(--pastille-neutre);
                aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; }
    .vignette img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .vignette .legende { position: absolute; left: 0; right: 0; bottom: 0; padding: 7px 9px;
                         font-size: 12px; color: #fff; background: linear-gradient(transparent, rgba(0,0,0,.62)); }
    .vignette .retirer { position: absolute; top: 7px; right: 7px; border: none; border-radius: 8px;
                         background: rgba(255,255,255,.9); color: var(--encre-2); cursor: pointer;
                         width: 26px; height: 26px; font-size: 13px; }
    .vignette .retirer:hover { color: var(--accent); }
    .depot { border: 1px dashed var(--bordure); border-radius: 12px; aspect-ratio: 4 / 3;
             display: flex; flex-direction: column; align-items: center; justify-content: center;
             gap: 6px; cursor: pointer; color: var(--encre-3); font-size: 13px; }
    .depot:hover { border-color: var(--accent); color: var(--accent); }
    .mot { padding: 12px 0; border-top: 1px solid var(--separateur); }
    .mot:first-of-type { border-top: none; }
    .mot .texte { white-space: pre-wrap; }
    .saisie { display: grid; grid-template-columns: 1fr 200px; gap: 10px; align-items: end; }
    @media (max-width: 700px) { .saisie { grid-template-columns: 1fr; } }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>Souvenirs</h1>
        <p class="secondaire" style="margin:6px 0 0">
          Un album par séjour, alimenté par la famille. Rien ne sort de cette instance.
        </p>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      @if (vue(); as v) {
        @if (ouvert(); as a) {
          <section class="carte">
            <div class="entre">
              <div>
                <button class="btn-lien" type="button" (click)="fermer()">‹ Tous les albums</button>
                <h2 style="margin:4px 0 2px">{{ a.titre }}</h2>
                <div class="secondaire" style="font-size:12.5px">{{ metaAlbum() }}</div>
              </div>
            </div>

            <div class="grille" style="margin-top:14px">
              <label class="depot">
                <i class="bi bi-plus-lg" aria-hidden="true"></i>
                {{ occupe() ? 'Envoi en cours...' : 'Déposer une photo' }}
                <input type="file" accept="image/*" multiple (change)="deposer($event)"
                       [disabled]="occupe()" style="display:none">
              </label>
              @for (p of photos(); track p.id) {
                <figure class="vignette" style="margin:0">
                  @if (fichiers.image(p.vignetteId ?? p.fichierId)(); as src) {
                    <img [src]="src" [alt]="p.legende || 'Photo déposée par ' + (p.deposeParNom ?? 'la famille')">
                  } @else {
                    <i class="bi bi-image" aria-hidden="true"></i>
                  }
                  @if (p.legende) { <figcaption class="legende">{{ p.legende }}</figcaption> }
                  @if (peutRetirer(p)) {
                    <button class="retirer" type="button" [disabled]="occupe()"
                            [attr.aria-label]="'Retirer la photo de ' + (p.deposeParNom ?? 'la famille')"
                            (click)="retirer(p)">
                      <i class="bi bi-x-lg" aria-hidden="true"></i>
                    </button>
                  }
                </figure>
              }
            </div>
            @if (!photos().length) {
              <p class="secondaire" style="margin:12px 0 0">
                Cet album est vide. Les photos déposées ici restent sur votre serveur.
              </p>
            }
          </section>
        } @else {
          <section class="carte">
            <div class="entre">
              <h2>Albums</h2>
              <button class="btn" type="button" (click)="creation.set(!creation())">
                {{ creation() ? 'Fermer' : 'Nouvel album' }}
              </button>
            </div>

            @if (creation()) {
              <form class="saisie" style="margin:14px 0 4px" (ngSubmit)="creer()">
                <div>
                  <label for="a-titre">Titre</label>
                  <input id="a-titre" name="atitre" [(ngModel)]="fTitre" placeholder="Été à la maison">
                </div>
                <div>
                  <label for="a-annee">Année</label>
                  <input id="a-annee" name="aannee" type="number" min="1900" max="2200" [(ngModel)]="fAnnee">
                </div>
                <div style="grid-column:1/-1">
                  <button class="btn btn-primaire" type="submit" [disabled]="occupe() || !fTitre.trim()">
                    Créer l'album
                  </button>
                </div>
              </form>
            }

            <div class="albums" style="margin-top:14px">
              @for (a of v.albums; track a.id) {
                <button class="carte carte-cliquable album" type="button" (click)="ouvrirAlbum(a)">
                  <span class="couverture">
                    @if (fichiers.image(a.couvertureId)(); as src) {
                      <img [src]="src" alt="">
                    } @else {
                      <i class="bi bi-images" aria-hidden="true"></i>
                    }
                  </span>
                  <span class="dessous">
                    <span class="titre">{{ a.titre }}</span><br>
                    <span class="secondaire" style="font-size:12.5px">
                      {{ a.annee }} · {{ a.photos }} photo{{ a.photos > 1 ? 's' : '' }}
                    </span>
                  </span>
                </button>
              }
            </div>
            @if (!v.albums.length) {
              <p class="secondaire" style="margin:12px 0 0">
                Aucun album pour l'instant. Un album se crée tout seul à la fin de chaque séjour,
                et vous pouvez en ouvrir un dès maintenant.
              </p>
            }
          </section>
        }

        <section class="carte">
          <h2>Livre d'or</h2>
          <p class="secondaire" style="margin:6px 0 0">
            Les mots laissés à chaque fin de séjour, du plus récent au plus ancien.
          </p>
          <form class="saisie" style="margin:14px 0 6px" (ngSubmit)="ecrire()">
            <div style="grid-column:1/-1">
              <label for="m-texte">Votre mot</label>
              <textarea id="m-texte" name="mtexte" rows="3" [(ngModel)]="fTexte"
                        placeholder="Une semaine de pluie et de cartes, et personne n'a voulu repartir."></textarea>
            </div>
            <div>
              <label for="m-sign">Signature</label>
              <input id="m-sign" name="msign" [(ngModel)]="fSignature" placeholder="Les Berger, août 2026">
            </div>
            <div>
              <button class="btn btn-primaire" type="submit" [disabled]="occupe() || !fTexte.trim()">
                Laisser un mot
              </button>
            </div>
          </form>

          <div style="margin-top:8px">
            @for (m of v.mots; track m.id) {
              <div class="mot">
                <div class="texte">{{ m.texte }}</div>
                <div class="secondaire" style="font-size:12.5px;margin-top:5px">
                  {{ m.signature || m.ecritParNom }} · {{ horodatageLisible(m.ecritLe) }}
                </div>
              </div>
            }
            @if (!v.mots.length) {
              <p class="secondaire" style="margin:6px 0 0">Le livre d'or est encore vierge.</p>
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
