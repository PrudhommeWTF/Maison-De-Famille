// La fiche du bien.
//
// En tranche 1, elle porte l'identité du bien et sa capacité, qui sert à la
// détection de conflits. Les caractéristiques, le guide d'arrivée, l'inventaire
// et le carnet d'adresses arrivent en tranche 3, avec leur code : une carte
// vide qui promet un contenu à venir ne rend service à personne.
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import type { FicheBien } from '../core/modeles';

@Component({
  selector: 'app-fiche',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .photo {
      height: 250px; border-radius: 18px; background: var(--actif);
      display: grid; place-items: center; color: var(--encre-3); overflow: hidden; position: relative;
    }
    .photo img { width: 100%; height: 100%; object-fit: cover; }
    .photo i { font-size: 30px; }
    .depot { position: absolute; right: 14px; bottom: 14px; }
    .lignes .kv { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-top: 1px solid var(--separateur); }
    .lignes .kv:first-child { border-top: none; }
    .kv .cle { color: var(--encre-3); font-size: 12.5px; }
    .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 560px) { .deux { grid-template-columns: 1fr; } .photo { height: 170px; } }
  `],
  template: `
    <div class="colonne">
      @if (fiche(); as f) {
        <div class="photo">
          @if (f.bien.photoFichierId) {
            <img [src]="urlPhoto(f.bien.photoFichierId)" [alt]="'Photo de ' + f.bien.nom">
          } @else {
            <i class="bi bi-image" aria-hidden="true"></i>
          }
          @if (etat.estGeranteIci()) {
            <label class="btn depot">
              <i class="bi bi-upload" aria-hidden="true"></i> Photo
              <input type="file" accept="image/*" (change)="televerser($event)" style="display:none">
            </label>
          }
        </div>

        <div class="entre">
          <div>
            <h1>{{ f.bien.nom }}</h1>
            <p class="secondaire" style="margin:6px 0 0">
              {{ f.bien.adresse || f.bien.commune }}{{ f.bien.codePostal ? ', ' + f.bien.codePostal : '' }}
              · détenu par {{ f.structure.nom }}
            </p>
          </div>
          @if (etat.estGeranteIci()) {
            <button class="btn" (click)="edition.set(!edition())">
              {{ edition() ? 'Fermer' : 'Modifier la fiche' }}
            </button>
          }
        </div>

        @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
        @if (message()) { <div class="encart-positif">{{ message() }}</div> }

        @if (edition()) {
          <section class="carte">
            <h2>Modifier la fiche</h2>
            <form (ngSubmit)="enregistrer()" style="margin-top:12px">
              <div class="champ">
                <label for="f-nom">Nom</label>
                <input id="f-nom" name="nom" [(ngModel)]="e.nom" required>
              </div>
              <div class="deux">
                <div class="champ">
                  <label for="f-commune">Commune</label>
                  <input id="f-commune" name="commune" [(ngModel)]="e.commune" required>
                </div>
                <div class="champ">
                  <label for="f-cp">Code postal</label>
                  <input id="f-cp" name="codePostal" [(ngModel)]="e.codePostal" maxlength="10">
                </div>
              </div>
              <div class="champ">
                <label for="f-adresse">Adresse</label>
                <input id="f-adresse" name="adresse" [(ngModel)]="e.adresse" maxlength="240">
              </div>
              <div class="deux">
                <div class="champ">
                  <label for="f-couchages">Couchages</label>
                  <input id="f-couchages" name="couchages" type="number" min="1" max="100" [(ngModel)]="e.couchages" required>
                  <p class="meta" style="margin-top:4px">Sert à la détection de dépassement de capacité.</p>
                </div>
                <div class="champ">
                  <label for="f-type">Type</label>
                  <select id="f-type" name="type" [(ngModel)]="e.type">
                    <option value="mer">Bord de mer</option>
                    <option value="montagne">Montagne</option>
                    <option value="campagne">Campagne</option>
                    <option value="ville">Ville</option>
                  </select>
                </div>
              </div>
              <div class="champ">
                <label for="f-notes">Notes</label>
                <textarea id="f-notes" name="notes" [(ngModel)]="e.notes" maxlength="1000"></textarea>
              </div>
              <button class="btn btn-primaire" type="submit" [disabled]="occupe()">Enregistrer</button>
            </form>
          </section>
        }

        <div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
          <section class="carte">
            <h2>Caractéristiques</h2>
            <div class="lignes" style="margin-top:10px">
              <div class="kv"><span class="cle">Commune</span><span>{{ f.bien.commune }}</span></div>
              <div class="kv"><span class="cle">Couchages</span><span class="chiffres">{{ f.bien.couchages }}</span></div>
              <div class="kv"><span class="cle">Type</span><span>{{ typeLisible(f.bien.type) }}</span></div>
              <div class="kv"><span class="cle">Location saisonnière</span><span>{{ f.bien.locationActivee ? 'activée' : 'non activée' }}</span></div>
            </div>
          </section>

          <section class="carte">
            <h2>Détention</h2>
            <div class="lignes" style="margin-top:10px">
              <div class="kv"><span class="cle">Structure</span><span>{{ f.structure.nom }}</span></div>
              <div class="kv"><span class="cle">Mode</span><span>{{ modeLisible(f.structure.mode) }}</span></div>
              <div class="kv"><span class="cle">Règle de décision</span><span>{{ f.regleMajorite }}</span></div>
              <div class="kv"><span class="cle">Votre rôle</span><span>{{ roleLisible(f.role) }}</span></div>
            </div>
            @if (f.structure.notes) { <p class="secondaire" style="margin-top:12px">{{ f.structure.notes }}</p> }
          </section>
        </div>

        @if (f.bien.notes) {
          <section class="carte">
            <h2>Notes</h2>
            <p class="secondaire" style="margin-top:8px;white-space:pre-wrap">{{ f.bien.notes }}</p>
          </section>
        }
      }
    </div>
  `,
})
export class Fiche {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);

  readonly fiche = signal<FicheBien | null>(null);
  readonly edition = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  e = { nom: '', commune: '', codePostal: '', adresse: '', type: 'mer', couchages: 2, notes: '' };

  constructor() {
    effect(() => { const b = this.etat.bien(); if (b) void this.charger(b.id); });
  }

  private async charger(bienId: number): Promise<void> {
    const f = await this.api.get<FicheBien>(`/biens/${bienId}`).catch(() => null);
    this.fiche.set(f);
    if (f) {
      this.e = {
        nom: f.bien.nom, commune: f.bien.commune, codePostal: f.bien.codePostal,
        adresse: f.bien.adresse, type: f.bien.type, couchages: f.bien.couchages, notes: f.bien.notes,
      };
    }
  }

  urlPhoto(id: string): string {
    return `${document.baseURI.replace(/\/+$/, '')}/api/fichiers/${id}`;
  }

  typeLisible(t: string): string {
    return t === 'montagne' ? 'Montagne' : t === 'ville' ? 'Ville' : t === 'campagne' ? 'Campagne' : 'Bord de mer';
  }

  modeLisible(m: string): string {
    return m === 'sci' ? 'SCI' : m === 'nom_propre' ? 'Nom propre' : 'Indivision';
  }

  roleLisible(r: string): string {
    return r === 'gerant' ? 'Gérant' : r === 'detenteur' ? 'Détenteur' : r === 'membre_foyer' ? 'Membre de foyer' : 'Invité';
  }

  async enregistrer(): Promise<void> {
    const b = this.etat.bien();
    if (!b || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      await this.api.patch(`/biens/${b.id}`, { ...this.e, couchages: Number(this.e.couchages) });
      this.message.set('Fiche enregistrée.');
      this.edition.set(false);
      await this.charger(b.id);
      await this.etat.rafraichir();
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'enregistrement a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  async televerser(evt: Event): Promise<void> {
    const b = this.etat.bien();
    const fichier = (evt.target as HTMLInputElement).files?.[0];
    if (!b || !fichier) return;
    this.erreur.set('');
    try {
      await this.api.televerser(`/biens/${b.id}/photo`, fichier);
      await this.charger(b.id);
      this.message.set('Photo enregistrée.');
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "Le téléversement a échoué.");
    }
  }
}
