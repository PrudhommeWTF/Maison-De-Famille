// Qui administre la plateforme.
//
// **Deux droits qui ne se recouvrent pas.** Gérer un bien, c'est arbitrer des
// séjours et des dépenses. Administrer la plateforme, c'est tenir la machine.
// Cet écran n'accorde que le second, et il le dit, parce que la confusion des
// deux est exactement ce qu'on vient de défaire.
//
// L'écran vit ici et non dans « Personnes et rôles » : un administrateur qui
// n'est pas gérant n'ouvre pas cet écran-là, et il doit pouvoir désigner un
// successeur sans demander à quelqu'un d'autre.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Api, ErreurAppel } from '../../core/api';

interface Administrable {
  personneId: number;
  nom: string;
  email: string | null;
  administrateur: boolean;
  gerant: boolean;
}

@Component({
  selector: 'app-administration-administrateurs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-3">
      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      <section class="card">
        <div class="card-body">
          <h2 class="h5 card-title">Administrateurs de la plateforme</h2>
          <p class="text-body-secondary small" style="max-width:640px">
            Un administrateur tient l'instance : version et mises à jour, réglages, relais de
            courriel, journal, calendrier scolaire. <strong>Ce n'est pas la même chose que gérer
            un bien</strong> : ce droit n'ouvre l'accès à aucun bien, et une personne qui n'est
            rattachée à rien n'en voit toujours aucun.
          </p>
          <p class="text-body-secondary small" style="max-width:640px">
            Il se donne entre administrateurs, et il donne accès aux réglages de la section
            Sécurité, qui commandent qui voit les dépenses et combien de temps un code d'accès
            reste affiché. Chaque changement de réglage est écrit au journal avec son auteur.
            Ne l'accordez qu'à qui tient la machine.
          </p>

          @if (personnes().length) {
            <div class="table-responsive mt-3">
              <table class="table table-hover align-middle mb-0">
                <thead>
                  <tr class="eyebrow">
                    <th scope="col">Personne</th><th scope="col">Gère un bien</th>
                    <th scope="col">Administre la plateforme</th><th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of personnes(); track p.personneId) {
                    <tr>
                      <td class="small">
                        <span class="fw-medium">{{ p.nom }}</span>
                        @if (p.personneId === moi()) { <span class="text-body-secondary">, vous</span> }
                        @if (p.email) {
                          <span class="d-block text-body-secondary">{{ p.email }}</span>
                        }
                      </td>
                      <td class="small text-body-secondary">{{ p.gerant ? 'Oui' : 'Non' }}</td>
                      <td class="small">
                        @if (p.administrateur) {
                          <span class="badge rounded-pill text-primary-emphasis bg-primary-subtle
                                       border border-primary-subtle">Administrateur</span>
                        } @else {
                          <span class="text-body-secondary">Non</span>
                        }
                      </td>
                      <td class="text-end">
                        @if (p.administrateur) {
                          <button class="btn btn-sm btn-outline-secondary"
                                  [disabled]="occupe() || seulAdministrateur()"
                                  (click)="poser(p, false)">Retirer</button>
                        } @else {
                          <button class="btn btn-sm btn-outline-secondary" [disabled]="occupe()"
                                  (click)="poser(p, true)">Nommer</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            @if (seulAdministrateur()) {
              <!-- La règle est vérifiée par le serveur ; le bouton grisé évite
                   seulement de la découvrir par un refus. -->
              <div class="alert alert-primary small mt-3 mb-0">
                Il n'y a qu'un administrateur. Le retirer fermerait l'administration à tout le
                monde, et il faudrait un accès au serveur pour la rouvrir : nommez quelqu'un
                d'autre avant.
              </div>
            }
          } @else {
            <p class="text-body-secondary small mb-0">Chargement...</p>
          }
        </div>
      </section>
    </div>
  `,
})
export class AdministrationAdministrateurs {
  private readonly api = inject(Api);

  readonly personnes = signal<Administrable[]>([]);
  readonly moi = signal(0);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  readonly seulAdministrateur = computed(() => this.personnes().filter((p) => p.administrateur).length <= 1);

  constructor() { void this.charger(); }

  private async charger(): Promise<void> {
    const r = await this.api.get<{ personnes: Administrable[]; moi: number }>('/systeme/administrateurs')
      .catch(() => null);
    if (!r) return;
    this.personnes.set(r.personnes);
    this.moi.set(r.moi);
  }

  async poser(p: Administrable, actif: boolean): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      const r = await this.api.post<{ personnes: Administrable[]; moi: number }>(
        '/systeme/administrateurs', { personneId: p.personneId, actif });
      this.personnes.set(r.personnes);
      this.moi.set(r.moi);
      this.message.set(actif
        ? `${p.nom} administre la plateforme.`
        : `${p.nom} n'administre plus la plateforme.`);
    } catch (e) {
      // Le serveur dit déjà pourquoi (dernier administrateur, personne
      // inconnue) : le remplacer ferait perdre la seule information utile.
      this.erreur.set(e instanceof ErreurAppel ? e.message : "Le changement n'a pas pu être enregistré.");
    } finally {
      this.occupe.set(false);
    }
  }
}
