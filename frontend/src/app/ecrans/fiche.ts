// La fiche du bien.
//
// En tranche 1, elle porte l'identité du bien et sa capacité, qui sert à la
// détection de conflits. Les caractéristiques, le guide d'arrivée, l'inventaire
// et le carnet d'adresses arrivent en tranche 3, avec leur code : une carte
// vide qui promet un contenu à venir ne rend service à personne.
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Fichiers } from '../core/fichiers';
import { Etat } from '../core/etat';
import type { FicheBien } from '../core/modeles';

interface LigneFiche { id: number; cle: string; valeur: string }
interface Contact {
  id: number; nom: string; role: string; telephone: string; email: string; notes: string;
}

@Component({
  selector: 'app-fiche',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .contact { display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
               padding: 11px 0; border-bottom: 1px solid var(--separateur); }
    .contact:last-of-type { border-bottom: none; }
    .contact .meta { font-size: 12.5px; color: var(--encre-3); }
    .ajout { display: grid; grid-template-columns: 1fr 1.4fr auto; gap: 8px; margin-top: 12px; }
    .ajout-contact { display: grid; grid-template-columns: 1.2fr 130px 140px 1.2fr auto; gap: 8px; margin-top: 14px; }
    .lien { border: none; background: none; padding: 0 0 0 8px; font: inherit; font-size: 12.5px;
            color: var(--encre-3); text-decoration: underline; cursor: pointer; }
    .lien:hover { color: var(--accent); }
    @media (max-width: 860px) {
      .ajout, .ajout-contact { grid-template-columns: 1fr; }
    }
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
            <img [src]="fichiers.image(f.bien.photoFichierId)()" [alt]="'Photo de ' + f.bien.nom">
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
                <label for="f-loc">Location saisonnière</label>
                <select id="f-loc" name="locationActivee" [(ngModel)]="e.locationActivee">
                  <option [ngValue]="false">Non activée</option>
                  <option [ngValue]="true">Activée</option>
                </select>
                <p class="meta" style="margin-top:4px">
                  Ouvre l'écran Location saisonnière sur ce bien : réservations, loyers encaissés
                  et net à répartir. Sans cela, le module n'existe nulle part sur ce bien.
                </p>
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

        <div class="deux">
          <section class="carte">
            <h2><i class="bi bi-signpost-split" aria-hidden="true"></i> Guide d'arrivée</h2>
            <p class="secondaire" style="margin:4px 0 10px">
              Ce qu'il faut savoir en arrivant. Visible de tous ceux qui séjournent, sans les codes,
              qui vivent au coffre-fort avec leur propre portée.
            </p>
            @for (g of guide(); track g.id) {
              <div class="kv">
                <span class="cle">{{ g.cle }}</span>
                <span style="text-align:right">
                  {{ g.valeur }}
                  @if (peutModifierFiche()) {
                    <button class="lien" type="button" (click)="retirerLigneFiche(g.id)">retirer</button>
                  }
                </span>
              </div>
            }
            @if (!guide().length) {
              <p class="secondaire" style="margin:0">
                Rien pour l'instant. Les clés, l'eau, les poubelles, les voisins, le wifi.
              </p>
            }
            @if (peutModifierFiche()) {
              <form class="ajout" (ngSubmit)="ajouterLigneFiche('guide')">
                <input name="gcle" [(ngModel)]="fGuideCle" placeholder="Eau" aria-label="Intitulé">
                <input name="gval" [(ngModel)]="fGuideValeur" aria-label="Valeur"
                       placeholder="vanne générale sous l'escalier">
                <button class="btn" type="submit" [disabled]="occupe() || !fGuideCle.trim()">Ajouter</button>
              </form>
            }
          </section>

          <section class="carte">
            <h2>Inventaire</h2>
            @for (i of inventaire(); track i.id) {
              <div class="kv"><span class="cle">{{ i.libelle }}</span><span>{{ i.etat || 'Bon' }}</span></div>
            }
            @if (!inventaire().length) {
              <p class="secondaire" style="margin:8px 0 0">Aucune ligne d'inventaire.</p>
            }
            <button class="btn" type="button" style="margin-top:12px"
                    (click)="casse.set(!casse())">
              {{ casse() ? 'Fermer' : 'Signaler une casse' }}
            </button>
            @if (casse()) {
              <form class="ajout" style="margin-top:10px" (ngSubmit)="signalerCasse()">
                <input name="klib" [(ngModel)]="fCasseLibelle" aria-label="Ce qui est cassé"
                       placeholder="le matelas de la chambre nord">
                <input name="kdet" [(ngModel)]="fCasseDetail" aria-label="Détail"
                       placeholder="affaissé au milieu">
                <button class="btn btn-primaire" type="submit"
                        [disabled]="occupe() || !fCasseLibelle.trim()">Signaler</button>
              </form>
              <p class="secondaire" style="margin:8px 0 0;font-size:12.5px">
                Le signalement crée une tâche dans le carnet d'entretien et marque la ligne
                d'inventaire à remplacer.
              </p>
            }
          </section>
        </div>

        <section class="carte">
          <div class="entre">
            <h2><i class="bi bi-person-lines-fill" aria-hidden="true"></i> Carnet d'adresses</h2>
            <span class="pastille">{{ contacts().length }}</span>
          </div>
          <p class="secondaire" style="margin:4px 0 10px">
            Artisans, voisins, mairie, urgences. Utile le jour où la chaudière lâche pendant le
            séjour de quelqu'un qui ne connaît pas le plombier.
          </p>
          @for (c of contacts(); track c.id) {
            <div class="contact">
              <span class="pastille">{{ libelleRoleContact(c.role) }}</span>
              <span style="flex:1;min-width:150px">
                <span style="display:block;font-size:14px">{{ c.nom }}</span>
                @if (c.notes) { <span class="meta">{{ c.notes }}</span> }
              </span>
              @if (c.telephone) { <a class="btn" [href]="'tel:' + c.telephone">{{ c.telephone }}</a> }
              @if (c.email) { <a class="btn" [href]="'mailto:' + c.email">Courriel</a> }
              @if (peutModifierContacts()) {
                <button class="lien" type="button" (click)="retirerContact(c.id)">retirer</button>
              }
            </div>
          }
          @if (!contacts().length) {
            <p class="secondaire" style="margin:0">Aucun contact enregistré.</p>
          }
          @if (peutModifierContacts()) {
            <form class="ajout-contact" (ngSubmit)="ajouterContact()">
              <input name="cnom" [(ngModel)]="fContactNom" aria-label="Nom" placeholder="Le Bihan, plombier">
              <select name="crole" [(ngModel)]="fContactRole" aria-label="Rôle">
                @for (r of rolesContact(); track r.cle) { <option [value]="r.cle">{{ r.libelle }}</option> }
              </select>
              <input name="ctel" [(ngModel)]="fContactTel" aria-label="Téléphone" placeholder="02 98 00 00 00">
              <input name="cnotes" [(ngModel)]="fContactNotes" aria-label="Notes"
                     placeholder="Connaît la chaudière depuis 2009">
              <button class="btn" type="submit" [disabled]="occupe() || !fContactNom.trim()">Ajouter</button>
            </form>
          }
        </section>

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
  readonly fichiers = inject(Fichiers);

  readonly fiche = signal<FicheBien | null>(null);
  readonly edition = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  e = {
    nom: '', commune: '', codePostal: '', adresse: '', type: 'mer', couchages: 2,
    locationActivee: false, notes: '',
  };

  // La fiche **compose** : le guide vient du module maison, l'inventaire du
  // module entretien, le carnet d'adresses du module maison. L'écran ne calcule
  // rien et ne connaît l'intérieur d'aucun d'eux, comme le tableau de bord.
  readonly guide = signal<LigneFiche[]>([]);
  readonly peutModifierFiche = signal(false);
  readonly inventaire = signal<{ id: number; libelle: string; etat: string }[]>([]);
  readonly contacts = signal<Contact[]>([]);
  readonly rolesContact = signal<{ cle: string; libelle: string }[]>([]);
  readonly peutModifierContacts = signal(false);
  readonly casse = signal(false);

  fGuideCle = '';
  fGuideValeur = '';
  fCasseLibelle = '';
  fCasseDetail = '';
  fContactNom = '';
  fContactRole = 'artisan';
  fContactTel = '';
  fContactNotes = '';

  readonly libelleRoleContact = (r: string): string =>
    this.rolesContact().find((x) => x.cle === r)?.libelle ?? r;

  constructor() {
    effect(() => { const b = this.etat.bien(); if (b) void this.charger(b.id); });
  }

  private async charger(bienId: number): Promise<void> {
    const [f, fic, inv, con] = await Promise.all([
      this.api.get<FicheBien>(`/biens/${bienId}`).catch(() => null),
      this.api.get<{ guide: LigneFiche[]; peutModifier: boolean }>(`/biens/${bienId}/fiche`)
        .catch(() => null),
      this.api.get<{ id: number; libelle: string; etat: string }[]>(`/biens/${bienId}/inventaire`)
        .catch(() => []),
      // Le carnet d'adresses est réservé aux membres : un invité reçoit un 403,
      // et l'absence de carte est la bonne réponse, pas un message d'erreur.
      this.api.get<{ contacts: Contact[]; roles: { cle: string; libelle: string }[]; peutModifier: boolean }>(
        `/biens/${bienId}/contacts`).catch(() => null),
    ]);
    this.guide.set(fic?.guide ?? []);
    this.peutModifierFiche.set(fic?.peutModifier ?? false);
    this.inventaire.set(inv);
    this.contacts.set(con?.contacts ?? []);
    this.rolesContact.set(con?.roles ?? []);
    this.peutModifierContacts.set(con?.peutModifier ?? false);
    this.fiche.set(f);
    if (f) {
      this.e = {
        nom: f.bien.nom, commune: f.bien.commune, codePostal: f.bien.codePostal,
        adresse: f.bien.adresse, type: f.bien.type, couchages: f.bien.couchages,
        locationActivee: f.bien.locationActivee, notes: f.bien.notes,
      };
    }
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

  private async agir(quoi: () => Promise<string>): Promise<void> {
    const b = this.etat.bien();
    if (!b || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.message.set(await quoi());
      await this.charger(b.id);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  ajouterLigneFiche(section: 'caracteristique' | 'guide'): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fGuideCle.trim()) return Promise.resolve();
    return this.agir(async () => {
      await this.api.post(`/biens/${b.id}/fiche`, {
        section, cle: this.fGuideCle.trim(), valeur: this.fGuideValeur.trim(),
        ordre: this.guide().length + 1,
      });
      const cle = this.fGuideCle.trim();
      this.fGuideCle = '';
      this.fGuideValeur = '';
      return `« ${cle} » ajouté au guide d'arrivée.`;
    });
  }

  retirerLigneFiche(id: number): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.agir(async () => {
      await this.api.post(`/biens/${b.id}/fiche/${id}/archivage`, {});
      return 'Ligne retirée du guide.';
    });
  }

  signalerCasse(): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fCasseLibelle.trim()) return Promise.resolve();
    return this.agir(async () => {
      await this.api.post(`/biens/${b.id}/casse`, {
        libelle: this.fCasseLibelle.trim(), detail: this.fCasseDetail.trim(),
      });
      const quoi = this.fCasseLibelle.trim();
      this.fCasseLibelle = '';
      this.fCasseDetail = '';
      this.casse.set(false);
      return `Casse signalée : une tâche « Remplacer ${quoi} » attend dans le carnet d'entretien.`;
    });
  }

  ajouterContact(): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fContactNom.trim()) return Promise.resolve();
    return this.agir(async () => {
      await this.api.post(`/biens/${b.id}/contacts`, {
        nom: this.fContactNom.trim(), role: this.fContactRole,
        telephone: this.fContactTel.trim(), email: '', notes: this.fContactNotes.trim(),
      });
      const nom = this.fContactNom.trim();
      this.fContactNom = '';
      this.fContactTel = '';
      this.fContactNotes = '';
      return `${nom} ajouté au carnet d'adresses.`;
    });
  }

  retirerContact(id: number): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.agir(async () => {
      await this.api.post(`/biens/${b.id}/contacts/${id}/archivage`, {});
      return 'Contact retiré.';
    });
  }
}
