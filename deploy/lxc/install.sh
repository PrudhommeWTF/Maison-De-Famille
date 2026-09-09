#!/usr/bin/env bash
# ============================================================
# Maison de Famille : installation native dans un conteneur LXC
# (Debian ou Ubuntu). À lancer EN ROOT DANS LE CONTENEUR :
#
#   bash deploy/lxc/install.sh
#
# Le script est idempotent : le relancer met à jour le code et redémarre le
# service, sans toucher aux données.
#
# Variables d'environnement (toutes facultatives) :
#   MDF_REPO      URL Git (défaut : https://github.com/PrudhommeWTF/Maison-De-Famille.git)
#   MDF_BRANCH    branche à déployer (défaut : main)
#   MDF_SRC       chemin d'une copie locale du dépôt (sinon auto-détecté, puis cloné)
#   APP_DIR       dossier du code    (défaut : /opt/maison-de-famille)
#   DATA_DIR      dossier des données (défaut : /var/lib/maison-de-famille)
#   PORT          port d'écoute      (défaut : 8099)
# ============================================================
set -euo pipefail

MDF_REPO="${MDF_REPO:-https://github.com/PrudhommeWTF/Maison-De-Famille.git}"
MDF_BRANCH="${MDF_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/maison-de-famille}"
DATA_DIR="${DATA_DIR:-/var/lib/maison-de-famille}"
PORT="${PORT:-8099}"
ENV_FILE="/etc/maison-de-famille/mdf.env"
SERVICE_USER="maison"
UNITE="maison-de-famille"
# Mise à jour depuis l'interface. Éteinte par défaut : elle installe un
# assistant root, et cela se décide, ça ne se subit pas.
MAJ_AUTO="${MAJ_AUTO:-false}"

export NG_CLI_ANALYTICS=false

log() { echo -e "\e[1;32m[mdf]\e[0m $*"; }
err() { echo -e "\e[1;31m[mdf]\e[0m $*" >&2; }

[[ "${EUID}" -eq 0 ]] || { err "Ce script doit être lancé en root."; exit 1; }

# --- Garde-fou : ce script installe DANS un conteneur, pas sur l'hyperviseur ---
if [[ -z "${ALLOW_HOST:-}" ]] && { command -v pct >/dev/null 2>&1 || [[ -d /etc/pve ]]; }; then
  err "Vous semblez être sur l'hôte Proxmox VE, pas dans un conteneur."
  err "  Créez d'abord le conteneur :  bash deploy/lxc/proxmox-create.sh"
  err "  Ou, si vous êtes bien dedans :  ALLOW_HOST=1 bash deploy/lxc/install.sh"
  exit 1
fi

# --- Dépendances système, AVANT tout le reste ---
#
# L'ordre compte : l'étape suivante clone avec git, et la copie du code plus
# bas se fait avec rsync. Ni l'un ni l'autre n'est présent dans un conteneur
# Debian standard, et les chercher après les avoir utilisés donnait
# « git: command not found » sur une machine neuve.
log "Installation des paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git rsync sqlite3 >/dev/null

# --- Source : copie locale auto-détectée, sinon clone ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." 2>/dev/null && pwd || true)"
if [[ -z "${MDF_SRC:-}" ]]; then
  if [[ -d "${REPO_ROOT}/frontend" && -d "${REPO_ROOT}/backend" ]]; then
    MDF_SRC="${REPO_ROOT}"
    log "Source : copie locale ${MDF_SRC}"
  else
    MDF_SRC="/tmp/mdf-src-$$"
    log "Clone de ${MDF_REPO} (branche ${MDF_BRANCH})"
    git clone --depth 1 --branch "${MDF_BRANCH}" "${MDF_REPO}" "${MDF_SRC}"
  fi
fi


if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 22 ]]; then
  log "Installation de Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

# NodeSource ne publie pas pour toutes les versions de Debian le jour de leur
# sortie. Quand la distribution est trop récente pour lui, son dépôt s'ajoute
# sans erreur mais n'apporte rien, et la compilation échouerait plus loin sur un
# message sans rapport. On vérifie donc ce qu'on a réellement obtenu.
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 22 ]]; then
  err "Node.js 22 n'a pas pu être installé sur cette distribution."
  err "Obtenu : $(command -v node >/dev/null 2>&1 && node -v || echo 'rien')"
  err "NodeSource ne publie probablement pas encore pour $(. /etc/os-release && echo "${PRETTY_NAME}")."
  err "Recréez le conteneur sur la version précédente de Debian :"
  err "  DEBIAN=12 bash deploy/lxc/proxmox-create.sh"
  exit 1
fi
log "Node $(node -v), npm $(npm -v)"

# --- Utilisateur de service, sans shell ni mot de passe ---
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  log "Création de l'utilisateur ${SERVICE_USER}"
  useradd --system --home "${DATA_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

# --- Code ---
log "Copie du code dans ${APP_DIR}"
mkdir -p "${APP_DIR}"
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude dist --exclude data --exclude .angular \
  "${MDF_SRC}/" "${APP_DIR}/"

log "Compilation du backend"
# « better-sqlite3 » est un module natif. Il télécharge d'ordinaire un binaire
# tout prêt ; quand il n'y en a pas pour cette machine, il tente de le compiler
# et échoue sur une erreur node-gyp que personne ne veut lire à trois heures du
# matin. On ne préinstalle pas la chaîne de compilation (deux cents méga-octets
# sur un conteneur qui se veut minimal), on dit quoi faire si le cas arrive.
if ! npm --prefix "${APP_DIR}/backend" ci --silent; then
  err "L'installation des dépendances du backend a échoué."
  err "Cause la plus fréquente : « better-sqlite3 » n'a pas trouvé de binaire prêt"
  err "à l'emploi pour cette machine et a tenté de le compiler."
  err "Installez la chaîne de compilation, puis relancez ce script :"
  err "  apt-get install -y python3 make g++"
  exit 1
fi
npm --prefix "${APP_DIR}/backend" run build --silent

log "Compilation de l'application (cela prend une à deux minutes)"
npm --prefix "${APP_DIR}/frontend" ci --silent
npm --prefix "${APP_DIR}/frontend" run build --silent

# Les dépendances de développement ne servent plus : on ne laisse pas un
# compilateur et ses cent paquets sur une machine exposée.
npm --prefix "${APP_DIR}/backend" prune --omit=dev --silent

# --- Configuration ---
mkdir -p "$(dirname "${ENV_FILE}")" "${DATA_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  CLE_COFFRE="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  log "Création de ${ENV_FILE} avec un secret JWT engendré"
  cat > "${ENV_FILE}" <<EOF
# Configuration de Maison de Famille.
# Après toute modification :  systemctl restart ${UNITE}

NODE_ENV=production
PORT=${PORT}
MDF_MAJ_AUTO=${MAJ_AUTO}

# Interface d'écoute. « 0.0.0.0 » (toutes) pour que le premier démarrage soit
# atteignable depuis un navigateur du réseau local. Une fois un reverse-proxy
# installé SUR CETTE MACHINE, mettre 127.0.0.1 ferme l'accès direct au port.
MDF_HOST=0.0.0.0
MDF_DATA_DIR=${DATA_DIR}
MDF_STATIC_DIR=${APP_DIR}/frontend/dist/frontend/browser

# Engendré à l'installation. Le changer déconnecte toute la famille.
MDF_JWT_SECRET=${SECRET}

# Clé du coffre-fort des codes d'accès, engendrée à l'installation.
# Elle vit ICI et pas dans ${DATA_DIR} : une sauvegarde des données seule ne
# rend aucun code. GARDEZ-EN UNE COPIE AILLEURS, sinon une restauration sur une
# machine neuve rendra tout sauf les codes.
MDF_CLE_COFFRE=${CLE_COFFRE}

# À RENSEIGNER : l'adresse que la famille tape dans son navigateur.
# Obligatoire dès qu'un courriel part, ses liens sont absolus.
MDF_PUBLIC_URL=

# Relais SMTP. Sans lui, les notifications sont enregistrées mais ne partent pas.
# Utilisez un mot de passe d'application dédié.
MDF_SMTP_HOST=
MDF_SMTP_PORT=587
MDF_SMTP_USER=
MDF_SMTP_PASS=
MDF_SMTP_FROM=

# Uniquement si l'application est servie sous un sous-chemin.
MDF_BASE_HREF=/
EOF
  chmod 600 "${ENV_FILE}"
else
  log "Configuration existante conservée : ${ENV_FILE}"
  # Les chemins peuvent avoir changé entre deux versions : on les remet à jour
  # sans toucher au reste, et surtout sans écraser le secret.
  sed -i "s#^MDF_STATIC_DIR=.*#MDF_STATIC_DIR=${APP_DIR}/frontend/dist/frontend/browser#" "${ENV_FILE}"
fi

# --- Version déployée ---
#
# Sans cette ligne, le service retombe sur le « 0.0.0 » du package.json, se croit
# éternellement en retard, et propose de se mettre à jour vers la version qu'il
# exécute déjà. C'est arrivé sur une installation fraîche depuis le tag 0.0.5.
#
# Le tag exact d'abord (installation depuis une version publiée), le package.json
# ensuite (installation depuis une branche). Écrit à chaque passage, même sur une
# configuration existante : c'est le seul endroit qui sait ce qui vient d'être
# posé, et maj.sh réécrira la ligne à la prochaine mise à jour.
VERSION="$(git -C "${MDF_SRC}" describe --tags --exact-match 2>/dev/null || true)"
if [[ -z "${VERSION}" ]]; then
  VERSION="$(node -p "require('${MDF_SRC}/backend/package.json').version" 2>/dev/null || true)"
fi
VERSION="${VERSION#v}"
if [[ -n "${VERSION}" && "${VERSION}" != "0.0.0" ]]; then
  if grep -q '^MDF_VERSION=' "${ENV_FILE}"; then
    sed -i "s|^MDF_VERSION=.*|MDF_VERSION=${VERSION}|" "${ENV_FILE}"
  else
    echo "MDF_VERSION=${VERSION}" >> "${ENV_FILE}"
  fi
  log "Version déployée : ${VERSION}"
else
  err "Version indéterminable : le service l'affichera comme inconnue."
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"
chown -R root:root "${APP_DIR}"

# --- Unité systemd ---
log "Installation de l'unité systemd"
cat > "/etc/systemd/system/${UNITE}.service" <<EOF
[Unit]
Description=Maison de Famille
Documentation=https://github.com/PrudhommeWTF/Maison-De-Famille
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_DIR}/backend/dist/server.js
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
ReadWritePaths=${DATA_DIR}
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

# --- Mise à jour depuis l'interface (assistant root, déclenché par systemd) ---
#
# Le service tourne sans privilège et ne peut ni remplacer son code ni se
# redémarrer. Il dépose un fichier dans son répertoire de données ; l'unité
# `path` ci-dessous le voit apparaître et lance l'assistant, qui est en root.
# Le service ne gagne aucun droit : c'est tout l'intérêt du détour.
if [[ "${MAJ_AUTO}" =~ ^(1|true|yes|on)$ ]]; then
  log "Activation de la mise à jour depuis l'interface (assistant root)"
  install -m 0755 -o root -g root "${SCRIPT_DIR}/maj.sh" /usr/local/sbin/maison-de-famille-maj.sh
  cat > "/etc/systemd/system/${UNITE}-maj.service" <<EOF
[Unit]
Description=Maison de Famille, mise à jour
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=${ENV_FILE}
Environment=APP_DIR=${APP_DIR}
Environment=ENV_FILE=${ENV_FILE}
ExecStart=/usr/local/sbin/maison-de-famille-maj.sh
EOF
  cat > "/etc/systemd/system/${UNITE}-maj.path" <<EOF
[Unit]
Description=Maison de Famille, surveille le déclencheur de mise à jour

[Path]
PathExists=${DATA_DIR}/.maj-declencheur
Unit=${UNITE}-maj.service

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "${UNITE}-maj.path" >/dev/null 2>&1 || true
else
  # Éteinte : on retire l'assistant et les unités s'ils traînent d'une
  # installation précédente. Laisser un assistant root inutilisé serait une
  # surface d'attaque gratuite.
  systemctl disable --now "${UNITE}-maj.path" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${UNITE}-maj.path" "/etc/systemd/system/${UNITE}-maj.service" \
        /usr/local/sbin/maison-de-famille-maj.sh
fi

systemctl daemon-reload
systemctl enable "${UNITE}" >/dev/null
systemctl restart "${UNITE}"

sleep 3
if systemctl is-active --quiet "${UNITE}"; then
  IP="$(hostname -I | awk '{print $1}')"
  log "Service démarré."
  echo
  echo "  Application  : http://${IP}:${PORT}/"
  echo "  Journal      : journalctl -f -u ${UNITE}"
  echo "  Configuration: ${ENV_FILE}"
  echo "  Données      : ${DATA_DIR}"
  echo
  echo "  À faire maintenant :"
  echo "    1. renseigner MDF_PUBLIC_URL et le relais SMTP dans ${ENV_FILE}"
  echo "    1 bis. sauvegarder MDF_CLE_COFFRE ailleurs : sans elle, les codes"
  echo "           d'accès ne se relisent pas après une restauration"
  echo "    2. systemctl restart ${UNITE}"
  echo "    3. ouvrir l'application et créer le premier compte"
  if [[ "${MAJ_AUTO}" =~ ^(1|true|yes|on)$ ]]; then
    echo
    echo "  Mise à jour depuis l'interface : activée. Le service regarde"
    echo "  GitHub tout seul, rien de plus à activer."
  else
    echo
    echo "  Mise à jour depuis l'interface : désactivée. Pour l'activer,"
    echo "  relancez cet installateur avec MAJ_AUTO=true."
  fi
  echo
else
  err "Le service n'a pas démarré. Les vingt dernières lignes du journal :"
  journalctl -u "${UNITE}" -n 20 --no-pager >&2
  exit 1
fi
