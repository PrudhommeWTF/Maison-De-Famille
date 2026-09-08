// Les commandes du serveur, pour ne pas avoir à s'en souvenir.
//
// Cette section n'appelle rien et n'affiche aucune donnée : elle existe parce
// que le jour où l'application ne répond plus, c'est un terminal qu'il faut, et
// que personne ne retient le nom de l'unité systemd.
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-administration-serveur',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    pre {
      background: var(--bs-tertiary-bg); border-radius: var(--bs-border-radius);
      padding: 12px 14px; font-size: .78rem; overflow-x: auto; margin: .5rem 0 0;
    }
  `],
  template: `
    <div class="d-flex flex-column gap-3">
      <section class="card">
        <div class="card-body">
          <div class="eyebrow mb-2">Sur le serveur</div>
          <p class="text-body-secondary small">
            Ces commandes se lancent <strong>dans le conteneur</strong>, jamais sur l'hôte Proxmox.
            Depuis l'hôte : <code>pct enter &lt;ID&gt;</code>.
          </p>

          <h3 class="h6 mt-3">Suivre le journal</h3>
          <pre>journalctl -f -u maison-de-famille        # LXC
docker compose logs -f                     # Docker</pre>

          <h3 class="h6 mt-3">Redémarrer</h3>
          <pre>systemctl restart maison-de-famille</pre>

          <h3 class="h6 mt-3">Sauvegarder</h3>
          <pre>bash /opt/maison-de-famille/deploy/lxc/sauvegarde.sh</pre>

          <h3 class="h6 mt-3">Mettre à jour à la main</h3>
          <p class="text-body-secondary small mb-0">
            Relancer l'installateur suffit : il reprend le code, recompile et redémarre, sans
            toucher à la configuration ni aux données. Ajoutez <code>MAJ_AUTO=true</code> pour
            poser en même temps l'assistant root qui rend l'installation possible depuis l'écran
            Vue d'ensemble.
          </p>
          <pre>bash /opt/maison-de-famille/deploy/lxc/install.sh</pre>
        </div>
      </section>

      <section class="card">
        <div class="card-body">
          <div class="eyebrow mb-2">Le fichier de configuration</div>
          <p class="text-body-secondary small">
            Tout ce qui porte un secret vit là, et nulle part dans la base : le secret des
            sessions, la clé du coffre-fort, le mot de passe du relais de courriel.
            <strong>Sauvegardez-le ailleurs</strong> : sans la clé du coffre, les codes déjà
            enregistrés ne se relisent plus.
          </p>
          <pre>/etc/maison-de-famille/mdf.env</pre>
          <p class="text-body-secondary small mt-2 mb-0">
            Après toute modification : <code>systemctl restart maison-de-famille</code>.
          </p>
        </div>
      </section>
    </div>
  `,
})
export class AdministrationServeur {}
