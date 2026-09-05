#!/usr/bin/env bash
# ============================================================
# Restauration de Maison de Famille.
#
#   systemctl stop maison-de-famille
#   bash deploy/lxc/restauration.sh /chemin/vers/sauvegarde.tar.gz
#   systemctl start maison-de-famille
#
# Le script REFUSE de tourner pendant que le service tourne : restaurer sous
# une base ouverte donnerait une base corrompue et une panne difficile à
# comprendre.
#
# L'état actuel est mis de côté avant d'être remplacé : une restauration lancée
# par erreur se défait.
# ============================================================
set -euo pipefail

ARCHIVE="${1:-}"
DATA_DIR="${DATA_DIR:-/var/lib/maison-de-famille}"
UNITE="maison-de-famille"
SERVICE_USER="${SERVICE_USER:-maison}"

log() { echo -e "\e[1;32m[mdf]\e[0m $*"; }
err() { echo -e "\e[1;31m[mdf]\e[0m $*" >&2; }

[[ -n "${ARCHIVE}" && -f "${ARCHIVE}" ]] || { err "Usage : bash restauration.sh /chemin/sauvegarde.tar.gz"; exit 1; }
[[ "${EUID}" -eq 0 ]] || { err "Ce script doit être lancé en root."; exit 1; }

if systemctl is-active --quiet "${UNITE}" 2>/dev/null; then
  err "Le service tourne encore. Arrêtez-le d'abord :"
  err "  systemctl stop ${UNITE}"
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

log "Ouverture de l'archive"
tar -xzf "${ARCHIVE}" -C "${TMP}"
# L'export produit par l'application range tout sous « maison-de-famille/ », le
# script de sauvegarde à la racine : les deux formes sont acceptées.
RACINE="${TMP}"
[[ -f "${TMP}/maison-de-famille/maison.db" ]] && RACINE="${TMP}/maison-de-famille"
[[ -f "${RACINE}/maison.db" ]] || { err "Cette archive ne contient pas de base maison.db."; exit 1; }

if ! sqlite3 "${RACINE}/maison.db" "PRAGMA integrity_check" | grep -q '^ok$'; then
  err "La base de l'archive est corrompue. Rien n'a été touché."
  exit 1
fi
VERSION="$(sqlite3 "${RACINE}/maison.db" "SELECT MAX(version) FROM schema_migration" 2>/dev/null || echo '?')"
log "Base valide, schéma en version ${VERSION}"

if [[ -e "${DATA_DIR}/maison.db" ]]; then
  ECARTE="${DATA_DIR}.remplace-$(date +%Y%m%d-%H%M%S)"
  log "L'état actuel est mis de côté dans ${ECARTE}"
  mv "${DATA_DIR}" "${ECARTE}"
fi

mkdir -p "${DATA_DIR}"
cp "${RACINE}/maison.db" "${DATA_DIR}/maison.db"
[[ -d "${RACINE}/fichiers" ]] && cp -a "${RACINE}/fichiers" "${DATA_DIR}/"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"

log "Restauration terminée."
echo
echo "  Démarrer :  systemctl start ${UNITE}"
echo "  Vérifier :  journalctl -f -u ${UNITE}"
echo
echo "  Si le binaire déployé est plus ancien que le schéma restauré, le service"
echo "  refusera de démarrer et le dira : redéployez la version la plus récente."
