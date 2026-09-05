#!/usr/bin/env bash
# ============================================================
# Sauvegarde complète de Maison de Famille.
#
#   bash /opt/maison-de-famille/deploy/lxc/sauvegarde.sh [destination]
#
# Produit une archive unique contenant la base ET les pièces jointes. La base
# est copiée par « VACUUM INTO » et non par cp : copier un fichier SQLite
# pendant que le journal WAL est actif produit une base qui s'ouvre et à
# laquelle il manque les dernières écritures, ce qui est pire qu'une erreur.
#
# Le service n'a pas besoin d'être arrêté.
# ============================================================
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/maison-de-famille}"
DEST="${1:-${DATA_DIR}/sauvegardes}"
GARDER="${GARDER:-14}"
HORODATAGE="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${DEST}/maison-de-famille-${HORODATAGE}.tar.gz"

log() { echo -e "\e[1;32m[mdf]\e[0m $*"; }
err() { echo -e "\e[1;31m[mdf]\e[0m $*" >&2; }

[[ -f "${DATA_DIR}/maison.db" ]] || { err "Base introuvable : ${DATA_DIR}/maison.db"; exit 1; }
command -v sqlite3 >/dev/null || { err "sqlite3 est absent : apt-get install sqlite3"; exit 1; }

mkdir -p "${DEST}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

log "Copie cohérente de la base"
sqlite3 "${DATA_DIR}/maison.db" "VACUUM INTO '${TMP}/maison.db'"

log "Archivage de la base et des pièces jointes"
mkdir -p "${TMP}/paquet"
mv "${TMP}/maison.db" "${TMP}/paquet/maison.db"
[[ -d "${DATA_DIR}/fichiers" ]] && cp -a "${DATA_DIR}/fichiers" "${TMP}/paquet/"
cat > "${TMP}/paquet/manifeste.txt" <<EOF
Maison de Famille, sauvegarde du ${HORODATAGE}
Source        : ${DATA_DIR}
Version base  : $(sqlite3 "${DATA_DIR}/maison.db" "SELECT MAX(version) FROM schema_migration" 2>/dev/null || echo inconnue)
Restauration  : bash deploy/lxc/restauration.sh ${ARCHIVE}
EOF

tar -czf "${ARCHIVE}" -C "${TMP}/paquet" .
chmod 600 "${ARCHIVE}"

log "Rotation : ${GARDER} sauvegardes conservées"
ls -1t "${DEST}"/maison-de-famille-*.tar.gz 2>/dev/null | tail -n +"$((GARDER + 1))" | xargs -r rm -f

log "Sauvegarde écrite : ${ARCHIVE} ($(du -h "${ARCHIVE}" | cut -f1))"
echo
echo "  Vérifier son contenu :  tar -tzf ${ARCHIVE} | head"
echo "  La copier ailleurs   :  scp ${ARCHIVE} ailleurs:/sauvegardes/"
echo
echo "  Une sauvegarde qui reste sur la même machine ne protège que des erreurs"
echo "  humaines, pas d'une panne de disque. Copiez-la hors du conteneur."
