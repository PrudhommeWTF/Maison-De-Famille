// L'état du service.
//
// C'est l'écran à ouvrir quand quelque chose ne va pas. Il dit ce qu'aucun
// journal ne montre d'un coup d'oeil : combien de courriels attendent et avec
// quelle erreur exacte du relais, quelle version de schéma est appliquée, et
// combien d'octets traînent sans être cités par la base.
//
// Il porte aussi les commandes shell à lancer sur le serveur : quand
// l'application va mal, c'est là qu'il faut regarder, et l'écran ne suppose pas
// qu'on se souvienne du nom de l'unité systemd.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { horodatageLisible } from '../core/format';
import type { Etat as EtatModele } from '../core/modeles';

@Component({
  selector: 'app-etat',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .kv { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-top: 1px solid var(--separateur); }
    .kv:first-child { border-top: none; }
    .kv .cle { color: var(--encre-3); font-size: 12.5px; }
    pre {
      background: var(--pastille-neutre); border-radius: 10px; padding: 12px 14px;
      font-size: 12.5px; overflow-x: auto; margin: 8px 0 0;
    }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>État du service</h1>
        <p class="secondaire" style="margin:6px 0 0">Ce qu'il faut regarder quand quelque chose ne va pas.</p>
      </div>

      @if (etat(); as e) {
        <div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
          <section class="carte">
            <h2>Courriel</h2>
            <div style="margin-top:10px">
              <div class="kv">
                <span class="cle">Relais SMTP</span>
                <span>{{ e.courriel.relais || 'aucun' }}</span>
              </div>
              <div class="kv"><span class="cle">Expéditeur</span><span>{{ e.courriel.adresseExpediteur || '—' }}</span></div>
              <div class="kv"><span class="cle">Adresse publique</span><span>{{ e.courriel.adressePublique || '—' }}</span></div>
              <div class="kv"><span class="cle">En attente</span><span class="chiffres">{{ e.courriel.file.enAttente }}</span></div>
              <div class="kv"><span class="cle">Abandonnées</span><span class="chiffres">{{ e.courriel.file.abandonnees }}</span></div>
              <div class="kv"><span class="cle">Envoyées (24 h)</span><span class="chiffres">{{ e.courriel.file.envoyees24h }}</span></div>
            </div>

            @if (!e.courriel.relais) {
              <div class="encart" style="margin-top:12px">
                Aucun relais n'est configuré : les notifications s'accumulent sans partir. Définissez
                <code>MDF_SMTP_HOST</code>, <code>MDF_SMTP_FROM</code> et <code>MDF_PUBLIC_URL</code>,
                puis redémarrez le service.
              </div>
            }
            @if (e.courriel.file.dernieresErreurs.length) {
              <h3 style="margin-top:16px">Dernières erreurs du relais</h3>
              @for (x of e.courriel.file.dernieresErreurs; track x.cree) {
                <pre>{{ x.type }} · {{ horodatageLisible(x.cree) }}
{{ x.erreur }}</pre>
              }
            }
          </section>

          <section class="carte">
            <h2>Base de données</h2>
            <div style="margin-top:10px">
              <div class="kv"><span class="cle">Version du service</span><span>{{ e.version }}</span></div>
              <div class="kv">
                <span class="cle">Schéma</span>
                <span class="chiffres">{{ e.schema.applique }} / {{ e.schema.cible }}</span>
              </div>
              <div class="kv"><span class="cle">Répertoire de données</span><span>{{ e.donnees.repertoire }}</span></div>
              <div class="kv"><span class="cle">Personnes</span><span class="chiffres">{{ e.donnees.personnes }}</span></div>
              <div class="kv"><span class="cle">Biens</span><span class="chiffres">{{ e.donnees.biens }}</span></div>
              <div class="kv"><span class="cle">Séjours</span><span class="chiffres">{{ e.donnees.sejours }}</span></div>
              <div class="kv"><span class="cle">Fichiers</span><span class="chiffres">{{ e.donnees.fichiers }}</span></div>
              @if (e.donnees.orphelins.nombre) {
                <div class="kv">
                  <span class="cle">Fichiers orphelins</span>
                  <span class="chiffres">{{ e.donnees.orphelins.nombre }} ({{ ko(e.donnees.orphelins.octets) }})</span>
                </div>
              }
            </div>
          </section>
        </div>

        <section class="carte">
          <h2>Migrations appliquées</h2>
          <div style="margin-top:10px">
            @for (m of e.schema.migrations; track m.version) {
              <div class="kv">
                <span class="cle chiffres">{{ m.version }} · {{ m.libelle }}</span>
                <span class="meta">{{ horodatageLisible(m.appliqueLe) }} ({{ m.dureeMs }} ms)</span>
              </div>
            }
          </div>
        </section>

        <section class="carte">
          <h2>Sur le serveur</h2>
          <p class="secondaire" style="margin:6px 0 0">Les commandes utiles, pour ne pas avoir à s'en souvenir.</p>
          <h3 style="margin-top:14px">Suivre le journal</h3>
          <pre>journalctl -f -u maison-de-famille        # LXC
docker compose logs -f                     # Docker</pre>
          <h3 style="margin-top:14px">Sauvegarder</h3>
          <pre>bash /opt/maison-de-famille/deploy/lxc/sauvegarde.sh</pre>
          <h3 style="margin-top:14px">Redémarrer</h3>
          <pre>systemctl restart maison-de-famille</pre>
        </section>
      } @else {
        <div class="carte"><p class="vide">Chargement...</p></div>
      }
    </div>
  `,
})
export class EtatSysteme {
  private readonly api = inject(Api);
  readonly etat = signal<EtatModele | null>(null);
  readonly horodatageLisible = horodatageLisible;

  constructor() {
    void this.api.get<EtatModele>('/etat').then((e) => this.etat.set(e)).catch(() => this.etat.set(null));
  }

  ko(octets: number): string {
    return octets > 1048576 ? `${Math.round(octets / 1048576)} Mo` : `${Math.round(octets / 1024)} Ko`;
  }
}
