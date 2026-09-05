// Les biens gérés : ajouter, ouvrir, archiver.
//
// C'est l'écran qui porte la notion de structure. Le mode de détention se
// choisit à la création parce qu'il détermine tout le reste : les règles de
// vote, la répartition par défaut, et le vocabulaire affiché partout ailleurs.
//
// **Le retrait se fait en deux temps et n'efface rien.** Un encart explique que
// le bien est archivé, que ses séjours restent consultables, et que l'action est
// réversible. C'est plus honnête et plus sûr qu'une boîte de dialogue.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import type { BienResume } from '../core/modeles';

const MODES = [
  { valeur: 'indivision', icone: 'bi-people', titre: 'Indivision', description: "Plusieurs héritiers détiennent le bien ensemble. Les décisions se prennent à la majorité, l'unanimité pour vendre." },
  { valeur: 'sci', icone: 'bi-building', titre: 'SCI', description: 'Une société civile immobilière détient le bien. Les décisions suivent les statuts et se prennent en assemblée.' },
  { valeur: 'nom_propre', icone: 'bi-person', titre: 'Nom propre', description: 'Une seule personne est propriétaire. Elle décide et invite les autres, sans vote.' },
] as const;

@Component({
  selector: 'app-biens',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .mode {
      text-align: left; padding: 14px; border-radius: 12px; background: var(--surface);
      border: 1px solid var(--bordure-controle); cursor: pointer; font-family: inherit; color: var(--encre-2);
    }
    .mode[aria-pressed="true"] { border: 1.5px solid var(--accent); color: var(--accent); }
    .mode i { font-size: 18px; display: block; margin-bottom: 7px; }
    .mode .titre { font-family: var(--titre); font-size: 15px; font-weight: 500; margin-bottom: 4px; }
    .mode .desc { font-size: 12px; color: var(--encre-3); }
    .bien { display: flex; gap: 20px; justify-content: space-between; flex-wrap: wrap; }
    .bien .actions { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
    .puces { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
    .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 560px) { .deux { grid-template-columns: 1fr; } }
  `],
  template: `
    <div class="colonne">
      <div class="entre">
        <div>
          <h1>Biens gérés</h1>
          <p class="secondaire" style="margin:6px 0 0">
            Chaque bien appartient à une structure : c'est elle qui porte les règles de décision et le vocabulaire.
          </p>
        </div>
        <button class="btn btn-primaire" (click)="formulaire.set(!formulaire())">
          {{ formulaire() ? 'Fermer le formulaire' : 'Ajouter un bien' }}
        </button>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }

      @if (formulaire()) {
        <section class="carte">
          <h2>Ajouter un bien</h2>
          <p class="secondaire" style="margin:6px 0 16px">Comment ce bien est-il détenu ?</p>
          <div class="modes">
            @for (m of modes; track m.valeur) {
              <button class="mode" type="button" [attr.aria-pressed]="f.structureMode === m.valeur"
                      (click)="f.structureMode = m.valeur">
                <i class="bi" [class]="m.icone" aria-hidden="true"></i>
                <div class="titre">{{ m.titre }}</div>
                <div class="desc">{{ m.description }}</div>
              </button>
            }
          </div>

          <form (ngSubmit)="creer()">
            <div class="champ">
              <label for="b-snom">Nom de la structure</label>
              <input id="b-snom" name="structureNom" [(ngModel)]="f.structureNom" placeholder="Indivision Kerloc'h" required>
            </div>
            <div class="champ">
              <label for="b-nom">Nom du bien</label>
              <input id="b-nom" name="nom" [(ngModel)]="f.nom" placeholder="Maison de Kerloc'h" required>
            </div>
            <div class="deux">
              <div class="champ">
                <label for="b-commune">Commune</label>
                <input id="b-commune" name="commune" [(ngModel)]="f.commune" required>
              </div>
              <div class="champ">
                <label for="b-type">Type</label>
                <select id="b-type" name="type" [(ngModel)]="f.type">
                  <option value="mer">Bord de mer</option>
                  <option value="montagne">Montagne</option>
                  <option value="campagne">Campagne</option>
                  <option value="ville">Ville</option>
                </select>
              </div>
            </div>
            <div class="deux">
              <div class="champ">
                <label for="b-couchages">Couchages</label>
                <input id="b-couchages" name="couchages" type="number" min="1" max="100" [(ngModel)]="f.couchages" required>
              </div>
              <div class="champ">
                <label for="b-loc">Location saisonnière</label>
                <select id="b-loc" name="locationActivee" [(ngModel)]="f.locationActivee">
                  <option [ngValue]="false">Non louée</option>
                  <option [ngValue]="true">Louée en saison</option>
                </select>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-primaire" type="submit" [disabled]="occupe()">Créer le bien</button>
              <button class="btn" type="button" (click)="formulaire.set(false)">Annuler</button>
            </div>
          </form>
        </section>
      }

      @for (b of etat.biens(); track b.id) {
        <section class="carte bien">
          <div style="flex:1;min-width:240px">
            <h2>{{ b.nom }}</h2>
            <p class="secondaire" style="margin:4px 0 0">
              {{ b.commune }} · {{ b.couchages }} couchages · {{ b.locationActivee ? 'louée en saison' : 'non louée' }}
            </p>
            <div class="puces">
              <span class="pastille">{{ libelleMode(b) }} · {{ b.structureNom }}</span>
              <span class="pastille">{{ b.role === 'gerant' ? 'Vous gérez ce bien' : roleLisible(b.role) }}</span>
            </div>

            @if (retrait() === b.id) {
              <div class="encart" style="margin-top:14px">
                <strong>Retirer ce bien l'archive, cela n'efface rien.</strong>
                Les séjours, les documents et l'historique restent consultables en lecture seule,
                et vous pouvez le réactiver à tout moment. Pour supprimer définitivement, exportez
                d'abord l'instance depuis l'écran d'état.
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn" (click)="archiver(b, true)" [disabled]="occupe()">Retirer</button>
                  <button class="btn" (click)="retrait.set(null)">Garder</button>
                </div>
              </div>
            }
          </div>
          <div class="actions">
            <button class="btn btn-primaire" (click)="ouvrir(b)">Ouvrir le dossier</button>
            @if (b.role === 'gerant' && retrait() !== b.id) {
              <button class="btn-lien" (click)="retrait.set(b.id)">Retirer ce bien</button>
            }
          </div>
        </section>
      } @empty {
        <div class="carte"><p class="vide">Aucun bien pour l'instant. Ajoutez le premier.</p></div>
      }
    </div>
  `,
})
export class Biens {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly modes = MODES;

  readonly formulaire = signal(false);
  readonly retrait = signal<number | null>(null);
  readonly occupe = signal(false);
  readonly erreur = signal('');

  f = {
    structureMode: 'indivision' as string, structureNom: '', nom: '', commune: '',
    type: 'mer', couchages: 6, locationActivee: false,
  };

  libelleMode(b: BienResume): string {
    return b.structureMode === 'sci' ? 'SCI' : b.structureMode === 'nom_propre' ? 'Nom propre' : 'Indivision';
  }

  roleLisible(role: string): string {
    return role === 'detenteur' ? 'Vous détenez des parts' : role === 'membre_foyer' ? 'Membre de foyer' : 'Invité';
  }

  ouvrir(b: BienResume): void {
    this.etat.poserContexte(b.id);
    void this.router.navigate(['/']);
  }

  async creer(): Promise<void> {
    await this.agir(async () => {
      await this.api.post('/biens', { ...this.f, couchages: Number(this.f.couchages) });
      this.formulaire.set(false);
      this.f = { structureMode: 'indivision', structureNom: '', nom: '', commune: '', type: 'mer', couchages: 6, locationActivee: false };
      await this.etat.rafraichir();
    });
  }

  async archiver(b: BienResume, archiver: boolean): Promise<void> {
    await this.agir(async () => {
      await this.api.post(`/biens/${b.id}/archivage`, { archiver });
      this.retrait.set(null);
      await this.etat.rafraichir();
    });
  }

  private async agir(action: () => Promise<void>): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    try { await action(); }
    catch (e) { this.erreur.set(e instanceof ErreurAppel ? e.message : "L'action a échoué."); }
    finally { this.occupe.set(false); }
  }
}
