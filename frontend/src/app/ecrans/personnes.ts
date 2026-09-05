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
//      L'écran dit ce que cela veut dire avant de le montrer.
//   3. **Une structure doit compter deux gérants.** Le retrait qui ferait
//      descendre en dessous est refusé par le serveur ; l'écran le dit avant.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { dateLongue, initiales } from '../core/format';
import type { Foyer, Personne } from '../core/modeles';

interface RoleAttribue { structureId: number; role: string }
interface PersonneEtRoles extends Personne { roles: RoleAttribue[] }
interface Invitation { courrielEnFile: boolean; expireLe: string | null; lien: string | null }

const LIBELLES: Record<string, string> = {
  gerant: 'Gérant', detenteur: 'Détenteur', membre_foyer: 'Membre de foyer', invite: 'Invité',
};

@Component({
  selector: 'app-personnes',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .personne { display: grid; align-items: center; gap: 10px 14px; padding: 14px 0;
                border-bottom: 1px solid var(--separateur);
                grid-template-columns: 34px minmax(170px, 1.3fr) minmax(140px, 1fr) minmax(120px, 0.9fr) auto; }
    .personne:last-child { border-bottom: none; }
    .personne .nom { font-size: 14px; display: block; }
    .personne .actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
    .personne .actions select { width: auto; min-width: 150px; }
    .roles-de { display: flex; gap: 6px; flex-wrap: wrap; }
    .saisie { display: grid; grid-template-columns: 1fr 1fr 160px auto; gap: 10px; align-items: end; }
    .lien-repli { background: var(--fond-2); border: 1px solid var(--separateur); border-radius: var(--rayon-2);
                  padding: 12px; margin-top: 10px; }
    .lien-repli code { display: block; word-break: break-all; font-size: 12px; margin: 8px 0;
                       background: var(--fond); padding: 9px; border-radius: var(--rayon-3); }
    @media (max-width: 900px) {
      .saisie { grid-template-columns: 1fr; }
      /* Au doigt, une ligne en colonnes devient illisible : on empile, et les
         actions passent en pleine largeur pour rester atteignables au pouce. */
      .personne { grid-template-columns: 34px 1fr; }
      .personne .ident, .roles-de, .personne .actions { grid-column: 2; }
      .personne .actions { justify-content: flex-start; }
      .personne .actions select { width: 100%; }
    }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>Personnes et rôles</h1>
        <p class="secondaire" style="margin:6px 0 0">
          Qui a un accès, à quel titre, et sur quelle structure.
        </p>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      <section class="carte">
        <h2>Inviter quelqu'un</h2>
        <p class="secondaire" style="margin:4px 0 12px">
          La personne choisit elle-même son mot de passe : vous ne le connaissez jamais.
          Sans adresse de courriel, elle existe comme nom pour les quotes-parts, sans compte.
        </p>
        <form class="saisie" (ngSubmit)="creer()">
          <div>
            <label for="p-nom">Nom</label>
            <input id="p-nom" name="nom" [(ngModel)]="fNom" placeholder="Paul Prudhomme" required>
          </div>
          <div>
            <label for="p-email">Adresse de courriel (facultative)</label>
            <input id="p-email" name="email" type="email" [(ngModel)]="fEmail" placeholder="paul.exemple.fr">
          </div>
          <div>
            <label for="p-foyer">Foyer</label>
            <select id="p-foyer" name="foyerId" [(ngModel)]="fFoyerId">
              <option [ngValue]="0">Sans foyer</option>
              @for (f of foyers(); track f.id) { <option [ngValue]="f.id">{{ f.nom }}</option> }
            </select>
          </div>
          <button class="btn btn-primaire" type="submit" [disabled]="occupe() || !fNom.trim()">
            Créer et inviter
          </button>
        </form>

        <details style="margin-top:12px">
          <summary class="secondaire" style="cursor:pointer;font-size:13px">Créer un foyer</summary>
          <form class="saisie" style="margin-top:10px;grid-template-columns:1fr auto" (ngSubmit)="creerFoyer()">
            <div>
              <label for="f-nom">Nom du foyer</label>
              <input id="f-nom" name="foyerNom" [(ngModel)]="fFoyerNom" placeholder="Famille de Paul">
            </div>
            <button class="btn" type="submit" [disabled]="occupe() || !fFoyerNom.trim()">Ajouter</button>
          </form>
        </details>
      </section>

      @if (invitation(); as inv) {
        <section class="carte">
          <h2>Lien d'invitation de {{ invitePour() }}</h2>
          @if (inv.lien) {
            <div class="lien-repli">
              <p style="margin:0;font-size:13px">
                Transmettez ce lien à la personne, par message ou de vive voix. Il vaut pour choisir
                son mot de passe : ne le laissez pas traîner, et sachez que son affichage est
                enregistré dans le journal avec votre nom.
              </p>
              <code>{{ inv.lien }}</code>
              <p class="secondaire" style="margin:0;font-size:12.5px">
                Valable jusqu'au {{ dateLongue(inv.expireLe!.slice(0, 10)) }}.
                Redemander un lien annule celui-ci.
              </p>
            </div>
          } @else {
            <p class="secondaire" style="margin:0">
              Courriel d'invitation mis en file. S'il n'arrive pas, l'écran « État du service »
              montre la file et l'erreur exacte du relais.
            </p>
          }
          <button class="btn" type="button" style="margin-top:10px" (click)="invitation.set(null)">Fermer</button>
        </section>
      }

      <section class="carte">
        <div class="entre">
          <h2>{{ personnes().length }} personne{{ personnes().length > 1 ? 's' : '' }}</h2>
        </div>
        @if (!personnes().length) {
          <p class="secondaire" style="margin:8px 0 0">Personne pour le moment.</p>
        }
        @for (p of personnes(); track p.id) {
          <div class="personne">
            <span class="avatar">{{ initiales(p.nom) }}</span>
            <span class="ident">
              <span class="nom">{{ p.nom }}</span>
              <span class="meta">{{ p.email || 'Sans adresse de courriel' }}</span>
            </span>
            <span class="ident">
              <span class="meta" style="display:block">{{ p.foyerNom || 'Sans foyer' }}</span>
              <span class="pastille" [class.pastille-accent]="p.aUnCompte">
                {{ etatCompte(p) }}
              </span>
            </span>
            <span class="roles-de">
              @for (r of rolesIci(p); track r.role) {
                <span class="pastille" [class.pastille-accent]="r.role === 'gerant'">{{ libelle(r.role) }}</span>
              }
              @if (!rolesIci(p).length) { <span class="meta">Aucun rôle explicite</span> }
            </span>
            <span class="actions">
              <select [attr.aria-label]="'Donner un rôle à ' + p.nom"
                      (change)="donnerRole(p, $any($event.target))">
                <option value="">Donner un rôle...</option>
                @for (r of ROLES; track r) {
                  @if (!aLeRole(p, r)) { <option [value]="r">{{ libelle(r) }}</option> }
                }
              </select>
              @for (r of rolesIci(p); track r.role) {
                <button class="btn" type="button" [disabled]="occupe()" (click)="retirer(p, r.role)">
                  Retirer {{ libelle(r.role).toLowerCase() }}
                </button>
              }
              @if (p.email) {
                <button class="btn" type="button" [disabled]="occupe()" (click)="reinviter(p, false)">
                  {{ p.aUnCompte ? 'Renvoyer un lien' : 'Renvoyer l\\'invitation' }}
                </button>
              }
              <button class="btn" type="button" [disabled]="occupe()" (click)="reinviter(p, true)">
                Afficher le lien
              </button>
            </span>
          </div>
        }
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
  readonly invitePour = signal('');
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fNom = '';
  fEmail = '';
  fFoyerId = 0;
  fFoyerNom = '';

  readonly structureId = computed(() => this.etat.bien()?.structureId ?? 0);

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
