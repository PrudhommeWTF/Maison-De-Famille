#!/usr/bin/env bash
# ============================================================
# Les unités systemd de Maison de Famille, en un seul endroit.
#
# **Pourquoi ce fichier existe.** Les unités étaient écrites par install.sh, et
# par lui seul. La mise à jour depuis l'interface ne faisait qu'arrêter puis
# relancer le service : une correction dans une définition d'unité n'atteignait
# donc jamais une machine, sauf à y ouvrir un terminal. C'est la même impasse
# que l'assistant de mise à jour qui ne pouvait pas se réparer lui-même, un
# étage au-dessus.
#
# `install.sh` le charge depuis la source qu'il déploie, `maj.sh` depuis
# l'archive qu'il vient de télécharger : chacun écrit donc les unités de la
# version qu'il installe, et une correction voyage avec le code.
#
# Rien ne s'exécute au chargement : ce fichier ne définit qu'une fonction, et
# attend ses paramètres dans l'environnement (APP_DIR, ENV_FILE, DATA_DIR,
# SERVICE_USER, UNITE, MAJ_AUTO).
# ============================================================

ecrire_unites() {
  local app="${APP_DIR}" env="${ENV_FILE}" donnees="${DATA_DIR}"
  local compte="${SERVICE_USER}" unite="${UNITE}" auto="${MAJ_AUTO:-false}"

  cat > "/etc/systemd/system/${unite}.service" <<EOF
[Unit]
Description=Maison de Famille
Documentation=https://github.com/PrudhommeWTF/Maison-De-Famille
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${compte}
Group=${compte}
WorkingDirectory=${app}/backend
EnvironmentFile=${env}
# NODE_ENV appartient à CE service, et à lui seul. Tant qu'il vivait dans le
# fichier d'environnement, l'unité de mise à jour le lisait elle aussi : npm en
# déduisait « omit=dev », sautait tsc et le compilateur Angular, et la mise à
# jour depuis l'interface échouait sur « sh: 1: tsc: not found ». Foyer-App le
# pose ici depuis toujours, et sa mise à jour n'a jamais eu ce défaut.
Environment=NODE_ENV=production
ExecStart=/usr/bin/node ${app}/backend/dist/server.js
Restart=on-failure
RestartSec=5
# Le service refuse de démarrer si la configuration est incomplète : sans cette
# limite, systemd le relancerait indéfiniment et le journal serait illisible.
StartLimitBurst=5
StartLimitIntervalSec=120

# Durcissement. Le service n'a besoin d'écrire que dans son répertoire de
# données : tout le reste du système lui est en lecture seule.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${donnees}
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=false
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF

  # Le service tourne sans privilège et ne peut ni remplacer son code ni se
  # redémarrer. Il dépose un fichier dans son répertoire de données ; l'unité
  # `path` ci-dessous le voit apparaître et lance l'assistant, qui est en root.
  # Le service ne gagne aucun droit : c'est tout l'intérêt du détour.
  if [[ "${auto}" =~ ^(1|true|yes|on)$ ]]; then
    # L'unité de mise à jour ne porte surtout pas NODE_ENV : c'est elle qui
    # compile, et il lui faut les dépendances de développement.
    cat > "/etc/systemd/system/${unite}-maj.service" <<EOF
[Unit]
Description=Maison de Famille, mise à jour
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=${env}
Environment=APP_DIR=${app}
Environment=ENV_FILE=${env}
ExecStart=/usr/local/sbin/maison-de-famille-maj.sh
EOF
    cat > "/etc/systemd/system/${unite}-maj.path" <<EOF
[Unit]
Description=Maison de Famille, surveille le déclencheur de mise à jour

[Path]
PathExists=${donnees}/.maj-declencheur
Unit=${unite}-maj.service

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now "${unite}-maj.path" >/dev/null 2>&1 || true
  else
    # Éteinte : on retire l'assistant et les unités s'ils traînent d'une
    # installation précédente. Laisser un assistant root inutilisé serait une
    # surface d'attaque gratuite.
    systemctl disable --now "${unite}-maj.path" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${unite}-maj.path" "/etc/systemd/system/${unite}-maj.service" \
          /usr/local/sbin/maison-de-famille-maj.sh
    systemctl daemon-reload
  fi
}
