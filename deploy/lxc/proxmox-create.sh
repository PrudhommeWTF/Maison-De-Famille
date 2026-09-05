#!/usr/bin/env bash
# ============================================================
# Création du conteneur LXC, à lancer SUR L'HÔTE Proxmox VE.
#
#   bash deploy/lxc/proxmox-create.sh
#
# Puis, dans le conteneur :
#   pct enter <ID>
#   bash /opt/maison-de-famille/deploy/lxc/install.sh
# ============================================================
set -euo pipefail

CTID="${CTID:-}"
HOSTNAME_CT="${HOSTNAME_CT:-maison-de-famille}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
TEMPLATE="${TEMPLATE:-debian-12-standard_12.7-1_amd64.tar.zst}"
DISK="${DISK:-8}"
MEMOIRE="${MEMOIRE:-1024}"
COEURS="${COEURS:-2}"
PONT="${PONT:-vmbr0}"

log() { echo -e "\e[1;32m[mdf]\e[0m $*"; }
err() { echo -e "\e[1;31m[mdf]\e[0m $*" >&2; }

command -v pct >/dev/null || { err "pct est introuvable : ce script se lance sur l'hôte Proxmox VE."; exit 1; }

[[ -n "${CTID}" ]] || CTID="$(pvesh get /cluster/nextid)"
log "Conteneur ${CTID} (${HOSTNAME_CT})"

if ! pveam list "${TEMPLATE_STORAGE}" | grep -q "${TEMPLATE}"; then
  log "Téléchargement du modèle ${TEMPLATE}"
  pveam update >/dev/null
  pveam download "${TEMPLATE_STORAGE}" "${TEMPLATE}"
fi

# Conteneur non privilégié : une exécution de code dans le service ne donne pas
# root sur l'hôte. C'est le réglage par défaut ici, et il n'y a aucune raison de
# le changer pour cette application.
pct create "${CTID}" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "${HOSTNAME_CT}" \
  --cores "${COEURS}" --memory "${MEMOIRE}" --swap 512 \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 "name=eth0,bridge=${PONT},ip=dhcp" \
  --features nesting=1 \
  --unprivileged 1 \
  --onboot 1

pct start "${CTID}"
sleep 5

log "Conteneur ${CTID} démarré."
echo
echo "  Entrer dedans   :  pct enter ${CTID}"
echo "  Puis installer  :  bash <(curl -fsSL https://raw.githubusercontent.com/PrudhommeWTF/Maison-De-Famille/main/deploy/lxc/install.sh)"
echo "  Adresse obtenue :  pct exec ${CTID} -- hostname -I"
echo
