// Les comptes de la famille.
//
// **Pourquoi cet écran a bougé.** « Personnes et rôles » faisait deux métiers à
// la fois : créer les comptes, qui vaut pour toute l'instance, et distribuer
// les rôles, qui ne vaut que pour la structure du bien ouvert. Les rôles sont
// partis sous le bien qu'ils concernent (« Rôles et accès »), les comptes sont
// ici, avec le reste de ce qui tient l'instance.
//
// **Deux profils ouvrent cet écran, et ils n'y font pas la même chose.**
//
//   - Une **gérante** administre les gens : elle crée, rattache à un foyer,
//     renvoie une invitation, et peut afficher le lien en clair, ce qui est
//     exactement le pouvoir de choisir le mot de passe de quelqu'un d'autre.
//     C'est assumé : elle a déjà tout accès à sa structure.
//   - Un **administrateur de plateforme** non gérant répare un accès, et rien
//     de plus. Il ne crée personne, n'archive personne, ne voit ni les foyers
//     ni les rôles, et **le lien d'invitation ne lui est jamais montré** : le
//     lui montrer reviendrait à lui laisser prendre le compte d'une gérante,
//     donc à ouvrir tous les biens à qui tient le serveur. Le courriel part,
//     ou rien ne part.
//
// Le second facteur est le cas qui a motivé la cloison : personne ne pouvait
// retirer celui d'un autre, et un téléphone perdu avec ses codes de secours
// fermait le compte pour toujours.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../../core/api';
import { Etat } from '../../core/etat';
import { dateLongue, initiales } from '../../core/format';
import { lienAbsolu } from '../../core/liens';
import type { Foyer, Personne } from '../../core/modeles';

interface Invitation { courrielEnFile: boolean; expireLe: string | null; lien: string | null }
interface Compte {
  id: number; nom: string; email: string | null;
  aUnCompte: boolean; derniereConnexion: string | null; secondFacteur: boolean;
}
/** Ce que la vue affiche : les faits du gérant, complétés du second facteur si on y a droit. */
interface Ligne extends Compte { foyerId: number | null; foyerNom: string | null }

@Component({
  selector: 'app-administration-personnes',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-3">
      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (gerante()) {
        <section class="card">
          <div class="card-body">
            <h2 class="h5 card-title">Inviter quelqu'un</h2>
            <p class="text-body-secondary small">
              La personne choisit elle-même son mot de passe : vous ne le connaissez jamais.
              Sans adresse de courriel, elle existe comme nom pour les quotes-parts, sans compte.
              Son rôle sur un bien se donne ensuite, depuis ce bien, section « Rôles et accès ».
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
              <p class="text-body-secondary small mt-2 mb-0" style="max-width:640px">
                Un foyer réunit ceux qui vivent ensemble. Il sert à compter les nuits d'un
                ménage d'un seul tenant, et à donner un rôle à tout le monde d'un coup.
              </p>
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
      } @else {
        <!-- Dire ce que cet écran ne fait pas vaut mieux que laisser chercher un
             bouton qui n'existe pas. -->
        <div class="alert alert-primary mb-0">
          Vous administrez la plateforme sans gérer de bien : vous pouvez rouvrir un accès
          fermé, et rien d'autre. Créer quelqu'un, le rattacher à un foyer ou lui donner un
          rôle reste au gérant du bien concerné.
        </div>
      }

      @if (invitation(); as inv) {
        <section class="card">
          <div class="card-body">
            <h2 class="h5 card-title">Invitation de {{ invitePour() }}</h2>
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
                Courriel d'invitation mis en file. S'il n'arrive pas, la section « Courriel »
                montre la file et l'erreur exacte du relais.
              </p>
            }
            <button class="btn btn-sm btn-outline-secondary mt-3" type="button"
                    (click)="invitation.set(null)">Fermer</button>
          </div>
        </section>
      }

      @if (debloquer(); as d) {
        <section class="card border-primary-subtle">
          <div class="card-body">
            <h2 class="h5 card-title">Retirer le second facteur de {{ d.nom }}</h2>
            <p class="text-body-secondary small" style="max-width:640px">
              <strong>Cette opération retire une protection sur le compte de quelqu'un d'autre.</strong>
              Elle se confirme par votre mot de passe, et elle est écrite au journal avec votre nom.
              Le mot de passe de {{ d.nom }} reste nécessaire pour entrer ; ses sessions ouvertes
              sont coupées, y compris sur un téléphone perdu.
            </p>
            <form (ngSubmit)="confirmerRetrait()">
              <div class="mb-3" style="max-width:340px">
                <label class="form-label small text-body-secondary" for="sf-mdp">Votre mot de passe</label>
                <input class="form-control" id="sf-mdp" name="motDePasse" type="password"
                       autocomplete="current-password" [(ngModel)]="motDePasse" required>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-primary" type="submit" [disabled]="occupe() || !motDePasse">Retirer</button>
                <button class="btn btn-outline-secondary" type="button" (click)="annulerRetrait()">Annuler</button>
              </div>
            </form>
          </div>
        </section>
      }

      <section class="card">
        <div class="card-body">
          <h2 class="h5 card-title">{{ lignes().length }} personne{{ lignes().length > 1 ? 's' : '' }}</h2>
          @if (!relaisConfigure() && !gerante()) {
            <p class="text-body-secondary small mb-0">
              Aucun relais de courriel n'est configuré : une invitation ne partirait nulle part.
              Voyez la section « Réglages ».
            </p>
          }
          @if (lignes().length) {
            <div class="table-responsive mt-3">
              <table class="table table-hover align-middle mb-0">
                <thead>
                  <tr class="eyebrow">
                    <th scope="col">Personne</th>
                    <th scope="col">{{ gerante() ? 'Foyer et compte' : 'Compte' }}</th>
                    @if (adminPlateforme()) { <th scope="col">Second facteur</th> }
                    <th class="text-end" scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of lignes(); track p.id) {
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
                        @if (gerante()) {
                          <span class="d-block text-body-secondary" style="font-size:.72rem">{{ p.foyerNom || 'Sans foyer' }}</span>
                        }
                        <span class="badge rounded-pill mt-1"
                              [class]="p.aUnCompte
                                ? 'text-success-emphasis bg-success-subtle border border-success-subtle'
                                : 'text-bg-light border'">{{ etatCompte(p) }}</span>
                      </td>
                      @if (adminPlateforme()) {
                        <td class="small text-body-secondary">{{ p.secondFacteur ? 'Actif' : 'Aucun' }}</td>
                      }
                      <td>
                        <span class="d-flex gap-2 flex-wrap justify-content-end align-items-center">
                          @if (p.email) {
                            <button class="btn btn-sm btn-outline-secondary" type="button"
                                    [disabled]="occupe()" (click)="reinviter(p, false)">
                              {{ p.aUnCompte ? 'Renvoyer un lien' : "Renvoyer l'invitation" }}
                            </button>
                          }
                          @if (gerante()) {
                            <button class="btn btn-sm btn-outline-secondary" type="button"
                                    [disabled]="occupe()" (click)="reinviter(p, true)">Afficher le lien</button>
                          }
                          @if (adminPlateforme() && p.secondFacteur) {
                            <button class="btn btn-sm btn-outline-secondary" type="button"
                                    [disabled]="occupe()" (click)="demanderRetrait(p)">
                              Retirer le second facteur
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
            <p class="text-body-secondary small mb-0">Personne pour le moment.</p>
          }
        </div>
      </section>
    </div>
  `,
})
export class AdministrationPersonnes {
  private readonly api = inject(Api);
  private readonly etat = inject(Etat);
  readonly initiales = initiales;
  readonly dateLongue = dateLongue;

  readonly gerante = computed(() => this.etat.estGerant());
  readonly adminPlateforme = computed(() => this.etat.estAdminPlateforme());

  readonly personnes = signal<Personne[]>([]);
  readonly comptes = signal<Compte[]>([]);
  readonly foyers = signal<Foyer[]>([]);
  readonly relaisConfigure = signal(true);
  readonly invitation = signal<Invitation | null>(null);
  readonly invitePour = signal('');
  readonly debloquer = signal<Compte | null>(null);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fNom = '';
  fEmail = '';
  fFoyerId = 0;
  fFoyerNom = '';
  motDePasse = '';

  /**
   * Une seule liste, deux sources selon le droit.
   *
   * La gérante voit la liste riche (`/personnes`, avec les foyers) ; le second
   * facteur y est joint depuis `/systeme/comptes` quand elle administre aussi.
   * L'administrateur non gérant ne voit que la liste pauvre, qui ne dit rien
   * des foyers.
   */
  readonly lignes = computed<Ligne[]>(() => {
    const sf = new Map(this.comptes().map((c) => [c.id, c.secondFacteur]));
    if (!this.gerante()) {
      return this.comptes().map((c) => ({ ...c, foyerId: null, foyerNom: null }));
    }
    return this.personnes().map((p) => ({
      id: p.id, nom: p.nom, email: p.email, aUnCompte: p.aUnCompte,
      derniereConnexion: p.derniereConnexion, secondFacteur: sf.get(p.id) ?? false,
      foyerId: p.foyerId, foyerNom: p.foyerNom,
    }));
  });

  /** L'état d'accès, dit du point de vue de qui lit la ligne. */
  readonly etatCompte = (p: Compte): string => {
    if (p.aUnCompte) return p.derniereConnexion ? `Vu le ${dateLongue(p.derniereConnexion.slice(0, 10))}` : 'Compte actif';
    return p.email ? 'Invitation en attente' : 'Sans compte';
  };

  /** `document.baseURI` et non `location.origin` : il porte le sous-chemin éventuel. */
  absolu(lien: string): string { return lienAbsolu(lien, document.baseURI); }

  constructor() { void this.charger(); }

  private async charger(): Promise<void> {
    const [p, f, c] = await Promise.all([
      this.gerante()
        ? this.api.get<Personne[]>('/personnes').catch(() => [])
        : Promise.resolve([]),
      this.gerante() ? this.api.get<Foyer[]>('/foyers').catch(() => []) : Promise.resolve([]),
      this.adminPlateforme()
        ? this.api.get<{ comptes: Compte[]; relaisConfigure: boolean }>('/systeme/comptes').catch(() => null)
        : Promise.resolve(null),
    ]);
    this.personnes.set(p);
    this.foyers.set(f);
    this.comptes.set(c?.comptes ?? []);
    if (c) this.relaisConfigure.set(c.relaisConfigure);
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
   * Deux routes pour un bouton, et la différence est le lien.
   *
   * La gérante passe par `/personnes/:id/invitation`, qui sait afficher le lien
   * en clair ; l'administrateur non gérant par `/systeme/comptes/:id/invitation`,
   * qui ne le rend jamais. Ce n'est pas une variante cosmétique : c'est toute la
   * cloison entre tenir la machine et tenir les gens.
   */
  reinviter(p: Ligne, afficherLien: boolean): Promise<void> {
    return this.tenter(async () => {
      if (!this.gerante()) {
        const r = await this.api.post<{ courrielEnFile: boolean; email: string }>(
          `/systeme/comptes/${p.id}/invitation`, {});
        return r.courrielEnFile
          ? `Invitation renvoyée à ${p.nom}, sur ${r.email}.`
          : `L'invitation de ${p.nom} n'a pas pu être mise en file.`;
      }
      const r = await this.api.post<Invitation>(`/personnes/${p.id}/invitation`, { afficherLien });
      this.invitePour.set(p.nom);
      this.invitation.set(r);
      return afficherLien ? `Lien d'invitation de ${p.nom} affiché ci-dessous.`
        : `Invitation renvoyée à ${p.nom}.`;
    });
  }

  demanderRetrait(p: Ligne): void {
    this.motDePasse = '';
    this.erreur.set('');
    this.message.set('');
    this.debloquer.set(p);
  }

  annulerRetrait(): void {
    this.motDePasse = '';
    this.debloquer.set(null);
  }

  confirmerRetrait(): Promise<void> {
    const d = this.debloquer();
    if (!d || !this.motDePasse) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/systeme/comptes/${d.id}/second-facteur/retrait`, { motDePasse: this.motDePasse });
      this.motDePasse = '';
      this.debloquer.set(null);
      return `Second facteur de ${d.nom} retiré. Prévenez-le : il devra le reconfigurer, `
        + 'et ses sessions ouvertes sont coupées.';
    });
  }
}
