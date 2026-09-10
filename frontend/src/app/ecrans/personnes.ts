// Les personnes, leurs foyers et leurs rôles.
//
// C'est l'écran par lequel la famille entre dans l'application. Il manquait :
// le serveur savait créer une personne depuis la tranche 1, mais aucun écran ne
// l'appelait, si bien qu'une gérante fraîchement installée restait seule.
//
// Trois choses s'y disent explicitement, parce qu'elles se devinent mal :
//
//   1. **Une personne sans adresse de courriel n'a pas de compte.** C'est un cas
//      légitime, pas un oubli : une quote-part peut appartenir à quelqu'un qui
//      n'ouvrira jamais l'application. L'écran l'affiche comme un état, pas
//      comme une erreur, plutôt que de laisser croire à une invitation perdue.
//   2. **Le lien d'invitation s'affiche en clair** quand le relais de courriel
//      n'est pas encore configuré, ce qui est le cas le jour de l'installation.
//      L'écran dit ce que cela veut dire avant de le montrer. Il le complète
//      aussi : sans `MDF_PUBLIC_URL`, le serveur rend un chemin nu, et c'est le
//      navigateur qui sait sur quelle adresse la gérante travaille. Voir
//      `core/liens.ts` pour ce que le serveur n'a pas le droit de deviner.
//   3. **Une structure doit compter deux gérants.** Le retrait qui ferait
//      descendre en dessous est refusé par le serveur ; l'écran le dit avant.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { dateLongue, initiales } from '../core/format';
import { lienAbsolu } from '../core/liens';
import type { Foyer, Personne } from '../core/modeles';

interface RoleAttribue { structureId: number; role: string }
interface PersonneEtRoles extends Personne { roles: RoleAttribue[] }
interface Invitation { courrielEnFile: boolean; expireLe: string | null; lien: string | null }
interface AccesTemporaire {
  id: number; libelle: string; expireLe: string; etat: 'actif' | 'expire' | 'revoque';
  derniereUtilisation: string | null; utilisations: number;
}

const LIBELLES: Record<string, string> = {
  gerant: 'Gérant', detenteur: 'Détenteur', membre_foyer: 'Membre de foyer', invite: 'Invité',
};

@Component({
  selector: 'app-personnes',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Personnes et rôles</h1>
        <p class="text-body-secondary mb-0">Qui a un accès, à quel titre, et sur quelle structure.</p>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      <section class="card">
        <div class="card-body">
          <h2 class="h5 card-title">Inviter quelqu'un</h2>
          <p class="text-body-secondary small">
            La personne choisit elle-même son mot de passe : vous ne le connaissez jamais.
            Sans adresse de courriel, elle existe comme nom pour les quotes-parts, sans compte.
          </p>
          <form class="row g-3 align-items-end" (ngSubmit)="creer()">
            <div class="col-12 col-md-4">
              <label class="form-label small text-body-secondary" for="p-nom">Nom</label>
              <input class="form-control" id="p-nom" name="nom" [(ngModel)]="fNom" placeholder="Paul Prudhomme" required>
            </div>
            <div class="col-12 col-md-4">
              <label class="form-label small text-body-secondary" for="p-email">Adresse de courriel (facultative)</label>
              <input class="form-control" id="p-email" name="email" type="email" [(ngModel)]="fEmail"
                     placeholder="paul.exemple.fr">
            </div>
            <div class="col-12 col-md-2">
              <label class="form-label small text-body-secondary" for="p-foyer">Foyer</label>
              <select class="form-select" id="p-foyer" name="foyerId" [(ngModel)]="fFoyerId">
                <option [ngValue]="0">Sans foyer</option>
                @for (f of foyers(); track f.id) { <option [ngValue]="f.id">{{ f.nom }}</option> }
              </select>
            </div>
            <div class="col-12 col-md-2">
              <button class="btn btn-primary w-100" type="submit" [disabled]="occupe() || !fNom.trim()">
                Créer et inviter
              </button>
            </div>
          </form>

          <details class="mt-3">
            <summary class="text-body-secondary small" style="cursor:pointer">Créer un foyer</summary>
            <form class="row g-3 align-items-end mt-0" (ngSubmit)="creerFoyer()">
              <div class="col-12 col-md-6">
                <label class="form-label small text-body-secondary" for="f-nom">Nom du foyer</label>
                <input class="form-control" id="f-nom" name="foyerNom" [(ngModel)]="fFoyerNom" placeholder="Famille de Paul">
              </div>
              <div class="col-auto">
                <button class="btn btn-outline-secondary" type="submit"
                        [disabled]="occupe() || !fFoyerNom.trim()">Ajouter</button>
              </div>
            </form>
          </details>
        </div>
      </section>

      @if (invitation(); as inv) {
        <section class="card">
          <div class="card-body">
            <h2 class="h5 card-title">Lien d'invitation de {{ invitePour() }}</h2>
            @if (inv.lien) {
              <div class="bg-body-tertiary border rounded p-3">
                <p class="small">
                  Transmettez ce lien à la personne, par message ou de vive voix. Il vaut pour choisir
                  son mot de passe : ne le laissez pas traîner, et sachez que son affichage est
                  enregistré dans le journal avec votre nom.
                </p>
                <code class="d-block bg-body p-2 rounded my-2" style="word-break:break-all">{{ absolu(inv.lien) }}</code>
                <p class="text-body-secondary small mb-0">
                  Valable jusqu'au {{ dateLongue(inv.expireLe!.slice(0, 10)) }}.
                  Redemander un lien annule celui-ci.
                </p>
              </div>
            } @else {
              <p class="text-body-secondary small mb-0">
                Courriel d'invitation mis en file. S'il n'arrive pas, l'Administration, section « Courriel »,
                montre la file et l'erreur exacte du relais.
              </p>
            }
            <button class="btn btn-sm btn-outline-secondary mt-3" type="button"
                    (click)="invitation.set(null)">Fermer</button>
          </div>
        </section>
      }

      @if (bienOuvert()) {
        <section class="card">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap">
              <h2 class="h5 card-title mb-0">
                <i class="bi bi-hourglass-split me-2" aria-hidden="true"></i>Accès temporaires
              </h2>
              <button class="btn btn-sm btn-outline-secondary" type="button" (click)="saisieAcces.set(!saisieAcces())">
                <i class="bi bi-person-plus me-1"></i>{{ saisieAcces() ? 'Fermer' : 'Ouvrir un accès' }}
              </button>
            </div>
            <p class="text-body-secondary small mt-2">
              Un invité ou un locataire entre par un lien, sans compte ni mot de passe, pour la durée
              que vous fixez. Il ne voit que le calendrier du bien et ce que le coffre-fort lui ouvre
              pendant son séjour. Vous pouvez révoquer à tout moment, et l'accès se coupe aussitôt.
            </p>

            @if (saisieAcces()) {
              <form class="row g-3 align-items-end mb-3" (ngSubmit)="ouvrirAcces()">
                <div class="col-12 col-md-4">
                  <label class="form-label small text-body-secondary" for="t-lib">Pour qui</label>
                  <input class="form-control" id="t-lib" name="tlib" [(ngModel)]="fAccesLibelle"
                         placeholder="Famille Berger, locataires">
                </div>
                <div class="col-12 col-md-3">
                  <label class="form-label small text-body-secondary" for="t-mail">Courriel (facultatif)</label>
                  <input class="form-control" id="t-mail" name="tmail" type="email" [(ngModel)]="fAccesEmail">
                </div>
                <div class="col-12 col-md-3">
                  <label class="form-label small text-body-secondary" for="t-fin">Valable jusqu'au</label>
                  <input class="form-control" id="t-fin" name="tfin" type="date" [(ngModel)]="fAccesExpire" [min]="demain()">
                </div>
                <div class="col-12 col-md-2">
                  <button class="btn btn-primary w-100" type="submit"
                          [disabled]="occupe() || !fAccesLibelle.trim() || !fAccesExpire">Créer le lien</button>
                </div>
              </form>
            }

            @if (lienAcces(); as la) {
              <div class="bg-body-tertiary border rounded p-3 mb-3">
                <p class="small">
                  Transmettez ce lien. Il vaut jusqu'au {{ dateLongue(la.expireLe) }}, et personne
                  n'aura besoin de mot de passe pour s'en servir : ne le publiez nulle part.
                </p>
                <code class="d-block bg-body p-2 rounded my-2" style="word-break:break-all">{{ absolu(la.lien) }}</code>
                <button class="btn btn-sm btn-outline-secondary" type="button" (click)="lienAcces.set(null)">Fermer</button>
              </div>
            }

            @if (acces().length) {
              <ul class="list-group list-group-flush">
                @for (a of acces(); track a.id) {
                  <li class="list-group-item d-flex gap-3 align-items-center flex-wrap px-0">
                    <span class="flex-grow-1" style="min-width:170px">
                      <span class="d-block small fw-medium">{{ a.libelle }}</span>
                      <span class="d-block text-body-secondary" style="font-size:.72rem">
                        Jusqu'au {{ dateLongue(a.expireLe) }}
                        @if (a.utilisations) { · utilisé {{ a.utilisations }} fois }
                        @else { · jamais utilisé }
                      </span>
                    </span>
                    <span class="badge rounded-pill"
                          [class]="a.etat === 'actif'
                            ? 'text-success-emphasis bg-success-subtle border border-success-subtle'
                            : 'text-bg-light border'">{{ etatAcces(a.etat) }}</span>
                    @if (a.etat === 'actif') {
                      <button class="btn btn-sm btn-outline-secondary" type="button"
                              [disabled]="occupe()" (click)="revoquer(a)">Révoquer</button>
                    }
                  </li>
                }
              </ul>
            } @else {
              <p class="text-body-secondary small mb-0">Aucun accès temporaire ouvert.</p>
            }
          </div>
        </section>
      }

      <section class="card">
        <div class="card-body">
          <h2 class="h5 card-title">{{ personnes().length }} personne{{ personnes().length > 1 ? 's' : '' }}</h2>
          @if (personnes().length) {
            <div class="table-responsive mt-3">
              <table class="table table-hover align-middle mb-0">
                <thead>
                  <tr class="eyebrow">
                    <th scope="col">Personne</th>
                    <th scope="col">Foyer et compte</th>
                    <th scope="col">Rôles sur ce bien</th>
                    <th class="text-end" scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of personnes(); track p.id) {
                    <tr>
                      <td>
                        <div class="d-flex align-items-center gap-3">
                          <span class="avatar">{{ initiales(p.nom) }}</span>
                          <span>
                            <span class="d-block small fw-medium">{{ p.nom }}</span>
                            <span class="d-block text-body-secondary" style="font-size:.72rem">
                              {{ p.email || 'Sans adresse de courriel' }}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span class="d-block text-body-secondary" style="font-size:.72rem">{{ p.foyerNom || 'Sans foyer' }}</span>
                        <span class="badge rounded-pill mt-1"
                              [class]="p.aUnCompte
                                ? 'text-success-emphasis bg-success-subtle border border-success-subtle'
                                : 'text-bg-light border'">{{ etatCompte(p) }}</span>
                      </td>
                      <td>
                        <span class="d-flex gap-1 flex-wrap">
                          @for (r of rolesIci(p); track r.role) {
                            <span class="badge rounded-pill"
                                  [class]="r.role === 'gerant'
                                    ? 'text-primary-emphasis bg-primary-subtle border border-primary-subtle'
                                    : 'text-bg-light border'">{{ libelle(r.role) }}</span>
                          }
                          @if (!rolesIci(p).length) {
                            <span class="text-body-secondary" style="font-size:.72rem">Aucun rôle explicite</span>
                          }
                        </span>
                      </td>
                      <td>
                        <span class="d-flex gap-2 flex-wrap justify-content-end align-items-center">
                          <select class="form-select form-select-sm w-auto"
                                  [attr.aria-label]="'Donner un rôle à ' + p.nom"
                                  (change)="donnerRole(p, $any($event.target))">
                            <option value="">Donner un rôle...</option>
                            @for (r of ROLES; track r) {
                              @if (!aLeRole(p, r)) { <option [value]="r">{{ libelle(r) }}</option> }
                            }
                          </select>
                          @for (r of rolesIci(p); track r.role) {
                            <button class="btn btn-sm btn-outline-secondary" type="button"
                                    [disabled]="occupe()" (click)="retirer(p, r.role)">
                              Retirer {{ libelle(r.role).toLowerCase() }}
                            </button>
                          }
                          @if (p.email) {
                            <button class="btn btn-sm btn-outline-secondary" type="button"
                                    [disabled]="occupe()" (click)="reinviter(p, false)">
                              {{ p.aUnCompte ? 'Renvoyer un lien' : 'Renvoyer l\\'invitation' }}
                            </button>
                          }
                          <button class="btn btn-sm btn-outline-secondary" type="button"
                                  [disabled]="occupe()" (click)="reinviter(p, true)">Afficher le lien</button>
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="text-body-secondary small mb-0">Personne pour le moment.</p>
          }
        </div>
      </section>
    </div>
  `,
})
export class Personnes {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly initiales = initiales;
  readonly dateLongue = dateLongue;
  readonly ROLES = ['gerant', 'detenteur', 'membre_foyer', 'invite'];

  readonly personnes = signal<PersonneEtRoles[]>([]);
  readonly foyers = signal<Foyer[]>([]);
  readonly invitation = signal<Invitation | null>(null);
  readonly acces = signal<AccesTemporaire[]>([]);
  readonly lienAcces = signal<{ lien: string; expireLe: string } | null>(null);

  /**
   * Le lien tel qu'il se transmet.
   *
   * `document.baseURI` et non `location.origin` : il porte le sous-chemin quand
   * l'application est servie sous un préfixe.
   */
  absolu(lien: string): string { return lienAbsolu(lien, document.baseURI); }
  readonly saisieAcces = signal(false);
  readonly invitePour = signal('');
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fNom = '';
  fEmail = '';
  fFoyerId = 0;
  fFoyerNom = '';
  fAccesLibelle = '';
  fAccesEmail = '';
  fAccesExpire = '';

  readonly structureId = computed(() => this.etat.bien()?.structureId ?? 0);
  readonly bienOuvert = computed(() => this.etat.bien());
  readonly demain = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  readonly etatAcces = (e: string): string =>
    e === 'actif' ? 'Actif' : e === 'expire' ? 'Expiré' : 'Révoqué';

  constructor() { void this.charger(); }

  readonly libelle = (r: string): string => LIBELLES[r] ?? r;
  readonly rolesIci = (p: PersonneEtRoles): RoleAttribue[] =>
    p.roles.filter((r) => r.structureId === this.structureId());
  readonly aLeRole = (p: PersonneEtRoles, role: string): boolean =>
    this.rolesIci(p).some((r) => r.role === role);

  /** L'état d'accès, dit du point de vue de la gérante qui lit la ligne. */
  readonly etatCompte = (p: Personne): string => {
    if (p.aUnCompte) return p.derniereConnexion ? `Vu le ${dateLongue(p.derniereConnexion.slice(0, 10))}` : 'Compte actif';
    return p.email ? 'Invitation en attente' : 'Sans compte';
  };

  private async charger(): Promise<void> {
    const [p, f] = await Promise.all([
      this.api.get<PersonneEtRoles[]>('/personnes').catch(() => [] as PersonneEtRoles[]),
      this.api.get<Foyer[]>('/foyers').catch(() => [] as Foyer[]),
    ]);
    this.personnes.set(p);
    this.foyers.set(f);
    const b = this.etat.bien();
    this.acces.set(b
      ? await this.api.get<AccesTemporaire[]>(`/biens/${b.id}/acces`).catch(() => [])
      : []);
  }

  private async tenter(quoi: () => Promise<string>): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.message.set(await quoi());
      await this.charger();
      await this.etat.charger();
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  creer(): Promise<void> {
    const nom = this.fNom.trim();
    if (!nom) return Promise.resolve();
    return this.tenter(async () => {
      const r = await this.api.post<{ id: number; courrielEnFile: boolean; expireLe: string | null }>(
        '/personnes', { nom, email: this.fEmail.trim(), foyerId: this.fFoyerId || null });
      this.fNom = ''; this.fEmail = '';
      if (r.courrielEnFile) {
        this.invitePour.set(nom);
        this.invitation.set({ courrielEnFile: true, expireLe: r.expireLe, lien: null });
        return `${nom} est créé, son invitation part par courriel.`;
      }
      // Pas de carte ici : annoncer un courriel qui ne part pas serait faux, et
      // ouvrir un lien que la gérante n'a pas demandé exposerait un accès pour rien.
      return `${nom} est créé. Sans adresse de courriel, il n'a pas de compte : `
        + 'il compte pour les quotes-parts et les répartitions. Pour lui ouvrir un accès, '
        + 'renseignez son adresse, ou utilisez « Afficher le lien ».';
    });
  }

  creerFoyer(): Promise<void> {
    const nom = this.fFoyerNom.trim();
    if (!nom) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post('/foyers', { nom });
      this.fFoyerNom = '';
      return `Foyer « ${nom} » créé.`;
    });
  }

  /**
   * Le menu se remet à « Donner un rôle... » tout de suite, avant même la
   * réponse : le rôle choisi sort de la liste des choix, et un menu resté sur
   * une valeur qui n'y figure plus s'affiche vide, ce qui a tout l'air d'un bug.
   */
  donnerRole(p: PersonneEtRoles, select: HTMLSelectElement): Promise<void> {
    const role = select.value;
    select.value = '';
    return this.attribuer(p, role);
  }

  attribuer(p: PersonneEtRoles, role: string): Promise<void> {
    if (!role || !this.structureId()) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/structures/${this.structureId()}/roles`, { personneId: p.id, role });
      return `${p.nom} est maintenant ${this.libelle(role).toLowerCase()}.`;
    });
  }

  retirer(p: PersonneEtRoles, role: string): Promise<void> {
    return this.tenter(async () => {
      await this.api.post(`/structures/${this.structureId()}/roles/retrait`, { personneId: p.id, role });
      return `Rôle ${this.libelle(role).toLowerCase()} retiré à ${p.nom}.`;
    });
  }

  ouvrirAcces(): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fAccesLibelle.trim() || !this.fAccesExpire) return Promise.resolve();
    return this.tenter(async () => {
      const r = await this.api.post<{ lien: string; acces: { expireLe: string } }>(
        `/biens/${b.id}/acces`, {
          libelle: this.fAccesLibelle.trim(), email: this.fAccesEmail.trim(),
          expireLe: this.fAccesExpire,
        });
      const nom = this.fAccesLibelle.trim();
      this.fAccesLibelle = '';
      this.fAccesEmail = '';
      this.saisieAcces.set(false);
      this.lienAcces.set({ lien: r.lien, expireLe: r.acces.expireLe });
      return `Accès ouvert pour ${nom}. Le lien s'affiche ci-dessous, il n'est rendu qu'une fois.`;
    });
  }

  revoquer(a: AccesTemporaire): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${b.id}/acces/${a.id}/revocation`, {});
      return `Accès de ${a.libelle} révoqué. Sa session en cours est coupée immédiatement.`;
    });
  }

  reinviter(p: PersonneEtRoles, afficherLien: boolean): Promise<void> {
    return this.tenter(async () => {
      const r = await this.api.post<Invitation>(`/personnes/${p.id}/invitation`, { afficherLien });
      this.invitePour.set(p.nom);
      this.invitation.set(r);
      return afficherLien ? `Lien d'invitation de ${p.nom} affiché ci-dessous.`
        : `Invitation renvoyée à ${p.nom}.`;
    });
  }
}
