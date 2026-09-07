// Les réglages, engendrés depuis le registre.
//
// **Aucun champ n'est écrit à la main ici.** L'écran lit la déclaration de
// chaque réglage (type, bornes, options, description) et fabrique le contrôle
// qui va avec. Ajouter un réglage dans `parametres/registre.ts` le fait
// apparaître ici sans que ce fichier soit rouvert : c'est tout l'intérêt du
// registre, et c'est ce que la CI vérifie.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Api, ErreurAppel } from '../../core/api';
import { Etat } from '../../core/etat';
import { SECTIONS } from '../../core/parametres/registre';
import type { ParametreExpose } from '../../core/modeles';

@Component({
  selector: 'app-administration-reglages',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-3">
      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @for (s of sectionsRemplies(); track s.id) {
        <section class="card" [attr.id]="s.id">
          <div class="card-body">
            <h2 class="h5 card-title">{{ s.libelle }}</h2>
            <p class="text-body-secondary small">{{ s.description }}</p>

            <ul class="list-group list-group-flush">
              @for (p of parametresDe(s.id); track p.cle) {
                <li class="list-group-item d-flex justify-content-between align-items-start gap-3 flex-wrap px-0 py-3">
                  <div class="flex-grow-1" style="max-width:620px">
                    <div class="small fw-medium d-flex align-items-center gap-2 flex-wrap">
                      {{ p.libelle }}
                      <span class="badge rounded-pill text-bg-light border fw-normal">
                        {{ libellePortee(p.portee) }}
                      </span>
                      @if (!p.parDefaut) {
                        <span class="badge rounded-pill text-primary-emphasis bg-primary-subtle
                                     border border-primary-subtle fw-normal">modifié</span>
                      }
                    </div>
                    <p class="text-body-secondary small mt-1 mb-0">{{ p.description }}</p>
                  </div>

                  <div class="flex-shrink-0" style="min-width:220px">
                    @switch (p.type) {
                      @case ('bool') {
                        <div class="form-check form-switch">
                          <input class="form-check-input" type="checkbox" role="switch"
                                 [attr.id]="'r-' + p.cle" [checked]="p.valeur === true"
                                 (change)="poser(p, $any($event.target).checked)">
                          <label class="form-check-label small" [attr.for]="'r-' + p.cle">
                            {{ p.valeur ? 'Activé' : 'Désactivé' }}
                          </label>
                        </div>
                      }
                      @case ('int') {
                        <input class="form-control" type="number" [min]="p.min ?? 0" [max]="p.max ?? 999"
                               [value]="p.valeur" (change)="poser(p, +$any($event.target).value)"
                               [attr.aria-label]="p.libelle">
                      }
                      @case ('enum') {
                        <select class="form-select" [value]="p.valeur"
                                (change)="poser(p, $any($event.target).value)" [attr.aria-label]="p.libelle">
                          @for (o of p.options ?? []; track o.valeur) {
                            <option [value]="o.valeur">{{ o.libelle }}</option>
                          }
                        </select>
                      }
                      @default {
                        <input class="form-control" type="text" [value]="p.valeur"
                               [attr.maxlength]="p.maxLongueur ?? 200"
                               (change)="poser(p, $any($event.target).value)" [attr.aria-label]="p.libelle">
                      }
                    }
                  </div>
                </li>
              }
            </ul>
          </div>
        </section>
      }
    </div>
  `,
})
export class AdministrationReglages {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);

  readonly instance = signal<ParametreExpose[]>([]);
  readonly duBien = signal<ParametreExpose[]>([]);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  readonly tous = computed(() => [...this.instance(), ...this.duBien()]);
  readonly sectionsRemplies = computed(() => SECTIONS.filter((s) => this.parametresDe(s.id).length));

  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  private ancreFaite = false;

  constructor() {
    effect(() => { const b = this.etat.bien(); void this.charger(b?.id ?? null); });
    // Le défilement vers l'ancre est fait ici et non par le routeur : les
    // sections n'existent qu'une fois le registre chargé, et le routeur cherche
    // l'élément bien avant, sur une page encore vide. « Activer dans les
    // Réglages » ouvrait donc la page en haut et laissait chercher.
    effect(() => {
      const fragment = this.route.snapshot.fragment;
      if (!fragment || this.ancreFaite || !this.sectionsRemplies().length) return;
      this.ancreFaite = true;
      requestAnimationFrame(() =>
        this.document.getElementById(fragment)?.scrollIntoView({ block: 'start' }));
    });
  }

  private async charger(bienId: number | null): Promise<void> {
    const [g, b] = await Promise.all([
      this.api.get<{ parametres: ParametreExpose[] }>('/parametres').catch(() => ({ parametres: [] })),
      bienId ? this.api.get<ParametreExpose[]>(`/biens/${bienId}/parametres`).catch(() => []) : Promise.resolve([]),
    ]);
    // Les réglages personnels ont leur place dans « Mon compte » : les répéter
    // ici ferait douter de l'endroit où l'on agit.
    this.instance.set(g.parametres.filter((p) => p.portee === 'instance'));
    // `/biens/:id/parametres` rend le registre entier vu depuis ce bien, donc
    // les réglages d'instance en font partie. Sans ce filtre, chacun s'affiche
    // deux fois, et on ne sait plus lequel des deux interrupteurs on actionne.
    this.duBien.set(b.filter((p) => p.portee === 'bien'));
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
}
