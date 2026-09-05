// La page de configuration, engendrée depuis le registre.
//
// **Aucun champ n'est écrit à la main ici.** L'écran lit la déclaration de
// chaque réglage (type, bornes, options, description) et fabrique le contrôle
// qui va avec. Ajouter un réglage dans `parametres/registre.ts` le fait
// apparaître ici sans que ce fichier soit rouvert : c'est tout l'intérêt du
// registre, et c'est ce que la CI vérifie.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { SECTIONS } from '../core/parametres/registre';
import type { ParametreExpose } from '../core/modeles';

@Component({
  selector: 'app-reglages',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .reglage { padding: 16px 0; border-top: 1px solid var(--separateur); }
    .reglage:first-of-type { border-top: none; padding-top: 6px; }
    .reglage .titre { display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
    .reglage .libelle { font-size: 14px; }
    .reglage .desc { font-size: 12.5px; color: var(--encre-3); margin: 5px 0 0; max-width: 620px; }
    .controle { min-width: 200px; }
    .interrupteur { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; }
    .interrupteur input { width: auto; min-height: 0; }
    .portee { font-size: 11px; }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>Réglages</h1>
        <p class="secondaire" style="margin:6px 0 0">
          Chaque réglage dit ce qu'il change et où l'effet se voit. Ceux marqués « bien » sont propres
          au bien ouvert.
        </p>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      @for (s of sectionsRemplies(); track s.id) {
        <section class="carte">
          <h2>{{ s.libelle }}</h2>
          <p class="secondaire" style="margin:4px 0 8px">{{ s.description }}</p>

          @for (p of parametresDe(s.id); track p.cle) {
            <div class="reglage">
              <div class="titre">
                <div>
                  <div class="libelle">
                    {{ p.libelle }}
                    <span class="pastille portee">{{ libellePortee(p.portee) }}</span>
                    @if (!p.parDefaut) { <span class="pastille portee pastille-accent">modifié</span> }
                  </div>
                  <p class="desc">{{ p.description }}</p>
                </div>

                <div class="controle">
                  @switch (p.type) {
                    @case ('bool') {
                      <label class="interrupteur">
                        <input type="checkbox" [checked]="p.valeur === true" (change)="poser(p, $any($event.target).checked)">
                        <span>{{ p.valeur ? 'Activé' : 'Désactivé' }}</span>
                      </label>
                    }
                    @case ('int') {
                      <input type="number" [min]="p.min ?? 0" [max]="p.max ?? 999" [value]="p.valeur"
                             (change)="poser(p, +$any($event.target).value)" [attr.aria-label]="p.libelle">
                    }
                    @case ('enum') {
                      <select [value]="p.valeur" (change)="poser(p, $any($event.target).value)" [attr.aria-label]="p.libelle">
                        @for (o of p.options ?? []; track o.valeur) { <option [value]="o.valeur">{{ o.libelle }}</option> }
                      </select>
                    }
                    @default {
                      <input type="text" [value]="p.valeur" [attr.maxlength]="p.maxLongueur ?? 200"
                             (change)="poser(p, $any($event.target).value)" [attr.aria-label]="p.libelle">
                    }
                  }
                </div>
              </div>
            </div>
          }
        </section>
      }

      <section class="carte">
        <h2>Export</h2>
        <p class="secondaire" style="margin:6px 0 14px">
          Vous n'êtes prisonnier ni d'un tableur ni de cette application. L'export complet contient la
          base et toutes les pièces jointes, et se restaure sur une instance vierge.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" (click)="exporter('/export/sejours.csv')" [disabled]="occupe()">
            <i class="bi bi-filetype-csv" aria-hidden="true"></i> Séjours en CSV
          </button>
          <button class="btn" (click)="exporter('/export/instance.tar.gz')" [disabled]="occupe()">
            <i class="bi bi-box-arrow-down" aria-hidden="true"></i> Export complet de l'instance
          </button>
        </div>
      </section>
    </div>
  `,
})
export class Reglages {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);

  readonly instance = signal<ParametreExpose[]>([]);
  readonly duBien = signal<ParametreExpose[]>([]);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  readonly tous = computed(() => [...this.instance(), ...this.duBien()]);
  readonly sectionsRemplies = computed(() => SECTIONS.filter((s) => this.parametresDe(s.id).length));

  constructor() {
    effect(() => { const b = this.etat.bien(); void this.charger(b?.id ?? null); });
  }

  private async charger(bienId: number | null): Promise<void> {
    const [g, b] = await Promise.all([
      this.api.get<{ parametres: ParametreExpose[] }>('/parametres').catch(() => ({ parametres: [] })),
      bienId ? this.api.get<ParametreExpose[]>(`/biens/${bienId}/parametres`).catch(() => []) : Promise.resolve([]),
    ]);
    // Les réglages personnels ont leur place dans « Mon compte » : les répéter
    // ici ferait douter de l'endroit où l'on agit.
    this.instance.set(g.parametres.filter((p) => p.portee === 'instance'));
    this.duBien.set(b);
  }

  parametresDe(section: string): ParametreExpose[] {
    return this.tous().filter((p) => p.section === section);
  }

  libellePortee(p: string): string {
    return p === 'bien' ? 'ce bien' : p === 'structure' ? 'structure' : p === 'personnel' ? 'vous' : 'instance';
  }

  async poser(p: ParametreExpose, valeur: unknown): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    const b = this.etat.bien();
    try {
      if (p.portee === 'bien' && b) await this.api.post(`/biens/${b.id}/parametres`, { cle: p.cle, valeur });
      else await this.api.post('/parametres', { cle: p.cle, valeur });
      this.message.set(`« ${p.libelle} » enregistré.`);
      await this.charger(b?.id ?? null);
      await this.etat.rafraichir();
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'enregistrement a échoué.");
      await this.charger(b?.id ?? null);
    } finally {
      this.occupe.set(false);
    }
  }

  async exporter(chemin: string): Promise<void> {
    this.occupe.set(true);
    this.erreur.set('');
    try {
      const { blob, nom } = await this.api.telecharger(chemin);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nom;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'export a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }
}
