// Qui a un rôle sur ce bien, et qui y entre par un lien.
//
// **Pourquoi cet écran a quitté « Personnes et rôles ».** L'ancien écran
// mélangeait deux métiers : créer les comptes de la famille, ce qui vaut pour
// toute l'instance, et distribuer les rôles, ce qui ne vaut que pour la
// structure du bien ouvert. On arrivait dessus depuis le portefeuille, sans
// bien ouvert, et la moitié de l'écran ne servait à rien ; on y venait avec un
// bien ouvert, et rien ne disait que le rôle qu'on donnait portait aussi sur
// les autres biens de la même structure. Les comptes sont désormais dans
// l'Administration, les rôles ici, sous le bien qu'ils concernent.
//
// **Ce que l'écran doit dire et ne disait pas.** Un rôle s'attribue sur la
// *structure*, pas sur le bien. Quand une SCI porte trois maisons, nommer
// quelqu'un détenteur lui ouvre les trois. C'est le bon modèle (les parts
// appartiennent à la structure), mais c'est une surprise si on ne le lit nulle
// part : le bandeau en haut le dit avant le premier clic.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { dateLongue, initiales } from '../core/format';
import { lienAbsolu } from '../core/liens';
import type { Foyer, Personne } from '../core/modeles';

interface RoleAttribue { structureId: number; role: string }
interface PersonneEtRoles extends Personne { roles: RoleAttribue[] }
interface AccesTemporaire {
  id: number; libelle: string; expireLe: string; etat: 'actif' | 'expire' | 'revoque';
  derniereUtilisation: string | null; utilisations: number;
}

const LIBELLES: Record<string, string> = {
  gerant: 'Gérant', detenteur: 'Détenteur', membre_foyer: 'Membre de foyer', invite: 'Invité',
};

const EXPLIQUE: Record<string, string> = {
  gerant: 'Arbitre les demandes de séjour et les dépenses, et tient cet écran.',
  detenteur: 'Voit les comptes et vote. La quote-part se saisit dans « Membres ».',
  membre_foyer: "Réserve, voit le calendrier et le coffre-fort, ne voit pas l'argent.",
  invite: 'Entre pour un séjour convenu, et rien de plus.',
};

@Component({
  selector: 'app-roles',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Rôles et accès</h1>
        <p class="text-body-secondary mb-0">
          Qui entre dans {{ etat.bien()?.nom }}, à quel titre, et pour combien de temps.
        </p>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (freres().length) {
        <!-- Dit avant le premier clic ce qui se découvrait après : le rôle porte
             sur la structure, donc sur ses autres biens. -->
        <div class="alert alert-primary mb-0">
          <i class="bi bi-info-circle me-2" aria-hidden="true"></i>
          Les rôles se donnent sur <strong>{{ etat.bien()?.structureNom }}</strong>, qui porte aussi
          {{ freres().join(', ') }}. Ce que vous accordez ici vaut donc pour
          {{ freres().length > 1 ? 'ces biens' : 'ce bien' }} également.
        </div>
      }

      <section class="card">
        <div class="card-body">
          <h2 class="h5 card-title">Ajouter un foyer entier</h2>
          <p class="text-body-secondary small">
            Le cas courant est un couple, ou une fratrie qui vit sous le même toit. Saisir le
            conjoint séparément s'oubliait, et l'oubli se lisait « je ne vois pas le calendrier »,
            ce qui ne se diagnostique pas tout seul.
          </p>
          <form class="row g-3 align-items-end" (ngSubmit)="ajouterFoyer()">
            <div class="col-12 col-md-5">
              <label class="form-label small text-body-secondary" for="r-foyer">Foyer</label>
              <select class="form-select" id="r-foyer" name="foyerId" [(ngModel)]="fFoyerId">
                <option [ngValue]="0">Choisir un foyer...</option>
                @for (f of foyers(); track f.id) {
                  <option [ngValue]="f.id">{{ f.nom }} ({{ tailleFoyer(f.id) }})</option>
                }
              </select>
            </div>
            <div class="col-12 col-md-4">
              <label class="form-label small text-body-secondary" for="r-foyer-role">Rôle</label>
              <select class="form-select" id="r-foyer-role" name="foyerRole" [(ngModel)]="fFoyerRole">
                @for (r of ROLES; track r) { <option [value]="r">{{ libelle(r) }}</option> }
              </select>
            </div>
            <div class="col-12 col-md-3">
              <button class="btn btn-primary w-100" type="submit" [disabled]="occupe() || !fFoyerId">
                Donner à tout le foyer
              </button>
            </div>
            <!-- L'explication sous la ligne entière, et non dans la colonne du
                 menu : elle rendait cette colonne plus haute que les deux
                 autres, et les libellés ne s'alignaient plus. -->
            <div class="col-12 form-text mt-0">{{ EXPLIQUE[fFoyerRole] }}</div>
          </form>
        </div>
      </section>

      <section class="card">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap">
            <h2 class="h5 card-title mb-0">
              {{ avecRole().length }} personne{{ avecRole().length > 1 ? 's' : '' }} avec un rôle
            </h2>
            <span class="text-body-secondary small">
              Les comptes se créent dans Administration, section « Personnes ».
            </span>
          </div>

          @if (avecRole().length) {
            <div class="table-responsive mt-3">
              <table class="table table-hover align-middle mb-0">
                <thead>
                  <tr class="eyebrow">
                    <th scope="col">Personne</th><th scope="col">Foyer</th>
                    <th scope="col">Rôles</th><th class="text-end" scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of avecRole(); track p.id) {
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
                      <td class="small text-body-secondary">{{ p.foyerNom || 'Sans foyer' }}</td>
                      <td>
                        <span class="d-flex gap-1 flex-wrap">
                          @for (r of rolesIci(p); track r.role) {
                            <span class="badge rounded-pill"
                                  [class]="r.role === 'gerant'
                                    ? 'text-primary-emphasis bg-primary-subtle border border-primary-subtle'
                                    : 'text-bg-light border'">{{ libelle(r.role) }}</span>
                          }
                        </span>
                      </td>
                      <td>
                        <span class="d-flex gap-2 flex-wrap justify-content-end align-items-center">
                          <select class="form-select form-select-sm w-auto"
                                  [attr.aria-label]="'Donner un rôle de plus à ' + p.nom"
                                  (change)="donnerRole(p, $any($event.target))">
                            <option value="">Ajouter un rôle...</option>
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
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="text-body-secondary small mb-0 mt-3">
              Personne n'a encore de rôle explicite ici. Les détenteurs inscrits dans « Membres »
              voient le bien sans qu'on leur donne quoi que ce soit.
            </p>
          }

          @if (sansRole().length) {
            <form class="row g-3 align-items-end mt-1 pt-3 border-top" (ngSubmit)="ajouterUn()">
              <div class="col-12 col-md-5">
                <label class="form-label small text-body-secondary" for="r-qui">Ajouter quelqu'un</label>
                <select class="form-select" id="r-qui" name="qui" [(ngModel)]="fPersonneId">
                  <option [ngValue]="0">Choisir une personne...</option>
                  @for (p of sansRole(); track p.id) {
                    <option [ngValue]="p.id">{{ p.nom }}{{ p.foyerNom ? ' (' + p.foyerNom + ')' : '' }}</option>
                  }
                </select>
              </div>
              <div class="col-12 col-md-4">
                <label class="form-label small text-body-secondary" for="r-role">Rôle</label>
                <select class="form-select" id="r-role" name="role" [(ngModel)]="fRole">
                  @for (r of ROLES; track r) { <option [value]="r">{{ libelle(r) }}</option> }
                </select>
              </div>
              <div class="col-12 col-md-3">
                <button class="btn btn-outline-secondary w-100" type="submit"
                        [disabled]="occupe() || !fPersonneId">Donner le rôle</button>
              </div>
              <div class="col-12 form-text mt-0">{{ EXPLIQUE[fRole] }}</div>
            </form>
          }
        </div>
      </section>

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
    </div>
  `,
})
export class Roles {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly initiales = initiales;
  readonly dateLongue = dateLongue;
  readonly ROLES = ['gerant', 'detenteur', 'membre_foyer', 'invite'];
  readonly EXPLIQUE = EXPLIQUE;

  readonly personnes = signal<PersonneEtRoles[]>([]);
  readonly foyers = signal<Foyer[]>([]);
  readonly acces = signal<AccesTemporaire[]>([]);
  readonly lienAcces = signal<{ lien: string; expireLe: string } | null>(null);
  readonly saisieAcces = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fPersonneId = 0;
  fRole = 'membre_foyer';
  fFoyerId = 0;
  fFoyerRole = 'membre_foyer';
  fAccesLibelle = '';
  fAccesEmail = '';
  fAccesExpire = '';

  readonly structureId = computed(() => this.etat.bien()?.structureId ?? 0);

  /** Les autres biens portés par la même structure : ce que le rôle ouvre en plus. */
  readonly freres = computed(() => {
    const b = this.etat.bien();
    return b ? this.etat.biens().filter((x) => x.structureId === b.structureId && x.id !== b.id).map((x) => x.nom) : [];
  });

  readonly avecRole = computed(() => this.personnes().filter((p) => this.rolesIci(p).length));
  readonly sansRole = computed(() => this.personnes().filter((p) => !this.rolesIci(p).length));

  readonly demain = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  readonly etatAcces = (e: string): string =>
    e === 'actif' ? 'Actif' : e === 'expire' ? 'Expiré' : 'Révoqué';
  readonly libelle = (r: string): string => LIBELLES[r] ?? r;
  readonly rolesIci = (p: PersonneEtRoles): RoleAttribue[] =>
    p.roles.filter((r) => r.structureId === this.structureId());
  readonly aLeRole = (p: PersonneEtRoles, role: string): boolean =>
    this.rolesIci(p).some((r) => r.role === role);
  readonly tailleFoyer = (id: number): string => {
    const n = this.personnes().filter((p) => p.foyerId === id).length;
    return n > 1 ? `${n} personnes` : `${n} personne`;
  };

  /** `document.baseURI` et non `location.origin` : il porte le sous-chemin éventuel. */
  absolu(lien: string): string { return lienAbsolu(lien, document.baseURI); }

  constructor() { void this.charger(); }

  private async charger(): Promise<void> {
    const b = this.etat.bien();
    const [p, f, a] = await Promise.all([
      this.api.get<PersonneEtRoles[]>('/personnes').catch(() => [] as PersonneEtRoles[]),
      this.api.get<Foyer[]>('/foyers').catch(() => [] as Foyer[]),
      b ? this.api.get<AccesTemporaire[]>(`/biens/${b.id}/acces`).catch(() => []) : Promise.resolve([]),
    ]);
    this.personnes.set(p);
    this.foyers.set(f);
    this.acces.set(a);
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

  /**
   * Le menu se remet à « Ajouter un rôle... » tout de suite, avant la réponse :
   * le rôle choisi sort de la liste des choix, et un menu resté sur une valeur
   * qui n'y figure plus s'affiche vide, ce qui a tout l'air d'un bug.
   */
  donnerRole(p: PersonneEtRoles, select: HTMLSelectElement): Promise<void> {
    const role = select.value;
    select.value = '';
    return role ? this.attribuer(p.id, p.nom, role) : Promise.resolve();
  }

  ajouterUn(): Promise<void> {
    const p = this.personnes().find((x) => x.id === this.fPersonneId);
    if (!p) return Promise.resolve();
    const role = this.fRole;
    this.fPersonneId = 0;
    return this.attribuer(p.id, p.nom, role);
  }

  private attribuer(personneId: number, nom: string, role: string): Promise<void> {
    if (!this.structureId()) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/structures/${this.structureId()}/roles`, { personneId, role });
      return `${nom} est maintenant ${this.libelle(role).toLowerCase()}.`;
    });
  }

  /**
   * Rend le compte de ce qui a été fait, et non un simple succès : « 2 ajoutés,
   * 1 avait déjà le rôle » se lit, « c'est fait » laisse dans le doute.
   */
  ajouterFoyer(): Promise<void> {
    const f = this.foyers().find((x) => x.id === this.fFoyerId);
    if (!f) return Promise.resolve();
    const role = this.fFoyerRole;
    return this.tenter(async () => {
      const r = await this.api.post<{ ajoutes: number; deja: string[]; total: number }>(
        `/structures/${this.structureId()}/roles/foyer`, { foyerId: f.id, role });
      this.fFoyerId = 0;
      // « ont le rôle » plutôt que « sont membres de foyer » : les quatre
      // libellés ne s'accordent pas de la même façon, et la tournure qui marche
      // pour l'un écrivait « sont membre de foyer » pour l'autre.
      const quoi = `le rôle « ${this.libelle(role)} »`;
      if (!r.ajoutes) return `Tout le foyer « ${f.nom} » avait déjà ${quoi}.`;
      return `${r.ajoutes} personne${r.ajoutes > 1 ? 's' : ''} du foyer « ${f.nom} » `
        + `${r.ajoutes > 1 ? 'ont' : 'a'} désormais ${quoi}.`
        + (r.deja.length ? ` ${r.deja.join(', ')} l'${r.deja.length > 1 ? 'avaient' : 'avait'} déjà.` : '');
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
}
