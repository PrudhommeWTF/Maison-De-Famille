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
# Vide par défaut : le modèle est découvert plus bas. Le figer sur un point de
# version précis (« 12.7-1 ») condamnait ce script à casser, parce que Proxmox
# retire les anciens de son miroir dès qu'une version corrective sort.
TEMPLATE="${TEMPLATE:-}"
DISK="${DISK:-8}"
MEMOIRE="${MEMOIRE:-1024}"
COEURS="${COEURS:-2}"
PONT="${PONT:-vmbr0}"

log() { echo -e "\e[1;32m[mdf]\e[0m $*"; }
err() { echo -e "\e[1;31m[mdf]\e[0m $*" >&2; }

command -v pct >/dev/null || { err "pct est introuvable : ce script se lance sur l'hôte Proxmox VE."; exit 1; }

[[ -n "${CTID}" ]] || CTID="$(pvesh get /cluster/nextid)"
log "Conteneur ${CTID} (${HOSTNAME_CT})"

# --- Le stockage du disque doit exister, sinon pct sort une erreur obscure ---
if ! pvesm status 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "${STORAGE}"; then
  err "Le stockage « ${STORAGE} » n'existe pas sur cet hôte."
  err "Stockages disponibles :"
  pvesm status | sed 's/^/    /' >&2
  err "Relancez en désignant le bon :  STORAGE=<nom> bash \$0"
  exit 1
fi

# --- Le modèle Debian 12, en trois temps ---
#
# 1. celui que l'appelant impose, s'il en impose un ;
# 2. sinon un modèle déjà téléchargé sur cet hôte, pour ne pas retélécharger
#    cent cinquante méga-octets à chaque conteneur ;
# 3. sinon le plus récent que le miroir propose.
deja_present() {
  pveam list "${TEMPLATE_STORAGE}" 2>/dev/null \
    | awk '{print $1}' | sed 's#.*/##' \
    | grep -E '^debian-12-standard_.*_amd64\.tar\.(zst|gz|xz)$' \
    | sort -V | tail -1
}

if [[ -z "${TEMPLATE}" ]]; then
  TEMPLATE="$(deja_present || true)"
  if [[ -n "${TEMPLATE}" ]]; then
    log "Modèle déjà présent : ${TEMPLATE}"
  else
    log "Recherche du modèle Debian 12 le plus récent"
    pveam update >/dev/null
    TEMPLATE="$(pveam available --section system 2>/dev/null \
      | awk '{print $NF}' \
      | grep -E '^debian-12-standard_.*_amd64\.tar\.(zst|gz|xz)$' \
      | sort -V | tail -1 || true)"
    if [[ -z "${TEMPLATE}" ]]; then
      err "Aucun modèle Debian 12 disponible sur ce miroir."
      err "Les modèles proposés :"
      pveam available --section system | sed 's/^/    /' >&2
      err "Choisissez-en un et relancez :  TEMPLATE=<nom> bash \$0"
      exit 1
    fi
    log "Téléchargement du modèle ${TEMPLATE}"
    pveam download "${TEMPLATE_STORAGE}" "${TEMPLATE}"
  fi
elif [[ -z "$(pveam list "${TEMPLATE_STORAGE}" 2>/dev/null | grep -F "${TEMPLATE}" || true)" ]]; then
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
