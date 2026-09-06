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
# Version majeure de Debian. 13 (trixie) est soutenue jusqu'en 2030, contre
# 2028 pour la 12 : sur une machine familiale qu'on installe une fois et qu'on
# ne retouche pas, deux ans de plus ne sont pas rien. Le repli sur 12 est
# automatique si le miroir ne propose pas encore la 13.
DEBIAN="${DEBIAN:-13}"
DEBIAN_REPLI="${DEBIAN_REPLI:-12}"
DISK="${DISK:-8}"
MEMOIRE="${MEMOIRE:-1024}"
COEURS="${COEURS:-2}"
PONT="${PONT:-vmbr0}"

log() { echo -e "\e[1;32m[mdf]\e[0m $*"; }
err() { echo -e "\e[1;31m[mdf]\e[0m $*" >&2; }

command -v pct >/dev/null || { err "pct est introuvable : ce script se lance sur l'hôte Proxmox VE."; exit 1; }

[[ -n "${CTID}" ]] || CTID="$(pvesh get /cluster/nextid)"
log "Conteneur ${CTID} (${HOSTNAME_CT})"

# --- Le stockage du disque, vérifié d'abord ---
#
# Le filtre porte sur « rootdir », le contenu « disque de conteneur », et pas
# seulement sur l'existence : un stockage de type répertoire existe souvent sans
# accepter de conteneur, et le proposer enverrait sur une seconde erreur.
# « local-lvm » n'existe pas sur un hôte ZFS, où c'est « local-zfs ».
stockages_conteneur() { pvesm status --content rootdir 2>/dev/null | awk 'NR>1 {print $1}'; }

if ! stockages_conteneur | grep -qx "${STORAGE}"; then
  err "Le stockage « ${STORAGE} » ne peut pas héberger le disque d'un conteneur."
  dispo="$(stockages_conteneur || true)"
  if [[ -n "${dispo}" ]]; then
    err "Ceux qui le peuvent sur cet hôte :"
    echo "${dispo}" | sed 's/^/    /' >&2
    err "Relancez en désignant le bon :  STORAGE=<nom> bash \$0"
  else
    err "Aucun stockage de cet hôte n'accepte de disque de conteneur."
    err "Ajoutez-en un dans Datacenter, Storage, avec le contenu « Container »."
  fi
  exit 1
fi

# --- Le modèle Debian, en trois temps ---
#
# 1. celui que l'appelant impose, s'il en impose un ;
# 2. sinon un modèle déjà téléchargé sur cet hôte, pour ne pas retélécharger
#    cent cinquante méga-octets à chaque conteneur ;
# 3. sinon le plus récent que le miroir propose.
#
# Le tri est un tri de VERSION et non alphabétique : sur « 12.9 » et « 12.12 »,
# un tri alphabétique choisirait 12.9, et on installerait toujours une version
# corrective en retard.
motif_debian() { echo "^debian-$1-standard_.*_amd64\.tar\.(zst|gz|xz)$"; }

deja_present() {
  pveam list "${TEMPLATE_STORAGE}" 2>/dev/null \
    | awk '{print $1}' | sed 's#.*/##' \
    | grep -E "$(motif_debian "$1")" | sort -V | tail -1
}

au_miroir() {
  pveam available --section system 2>/dev/null \
    | awk '{print $NF}' \
    | grep -E "$(motif_debian "$1")" | sort -V | tail -1
}

# La réutilisation locale ne porte QUE sur la majeure demandée. Rendre une
# Debian 12 déjà présente à quelqu'un qui a demandé la 13, pour lui épargner un
# téléchargement, serait lui donner autre chose que ce qu'il a demandé sans le
# lui dire. Le repli, lui, est annoncé.
if [[ -z "${TEMPLATE}" ]]; then
  TEMPLATE="$(deja_present "${DEBIAN}" || true)"
  [[ -n "${TEMPLATE}" ]] && log "Modèle déjà présent : ${TEMPLATE}"
fi

if [[ -z "${TEMPLATE}" ]]; then
  log "Recherche du modèle Debian le plus récent"
  pveam update >/dev/null
  for majeure in "${DEBIAN}" "${DEBIAN_REPLI}"; do
    TEMPLATE="$(au_miroir "${majeure}" || true)"
    if [[ -n "${TEMPLATE}" ]]; then
      [[ "${majeure}" != "${DEBIAN}" ]] \
        && log "Aucun modèle Debian ${DEBIAN} au miroir, repli sur Debian ${majeure}."
      break
    fi
  done
  if [[ -z "${TEMPLATE}" ]]; then
    err "Aucun modèle Debian ${DEBIAN} ni ${DEBIAN_REPLI} disponible sur ce miroir."
    err "Les modèles proposés :"
    pveam available --section system | sed 's/^/    /' >&2
    err "Choisissez-en un et relancez :  TEMPLATE=<nom> bash \$0"
    exit 1
  fi
fi

if [[ -z "$(pveam list "${TEMPLATE_STORAGE}" 2>/dev/null | grep -F "${TEMPLATE}" || true)" ]]; then
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

# --- Attendre le réseau avant de parler à apt ---
# L'adresse vient du DHCP : « pct start » rend la main bien avant qu'elle
# arrive, et un apt lancé trop tôt échoue sur une résolution de nom.
log "Attente du réseau dans le conteneur"
reseau=0
for _ in $(seq 1 30); do
  if pct exec "${CTID}" -- getent hosts deb.debian.org >/dev/null 2>&1; then reseau=1; break; fi
  sleep 2
done

# --- Préparer le conteneur ---
#
# Le modèle Debian embarque un index apt figé au jour de sa fabrication, et
# n'embarque pas curl. Sans ces deux commandes, la ligne d'installation affichée
# plus bas échoue d'abord sur « curl: command not found », puis, si on installe
# curl sans rafraîchir l'index, sur des 404 : le miroir a retiré les paquets de
# la version corrective que cet index réclame.
#
# L'échec n'est pas fatal : le conteneur existe, et on dit quoi taper dedans.
prepare=0
if [[ "${reseau}" -eq 1 ]]; then
  log "Préparation du conteneur (index apt et curl)"
  if pct exec "${CTID}" -- apt-get update -qq \
     && pct exec "${CTID}" -- apt-get install -y -qq curl ca-certificates; then
    prepare=1
  fi
else
  err "Le conteneur n'a pas obtenu d'adresse en soixante secondes."
fi

log "Conteneur ${CTID} démarré."
echo
if [[ "${prepare}" -eq 1 ]]; then
  echo "  Entrer dedans   :  pct enter ${CTID}"
  echo "  Puis installer  :  bash <(curl -fsSL https://raw.githubusercontent.com/PrudhommeWTF/Maison-De-Famille/main/deploy/lxc/install.sh)"
else
  err "La préparation a échoué. Dans le conteneur, avant d'installer :"
  echo "    pct enter ${CTID}"
  echo "    apt-get update && apt-get install -y curl ca-certificates"
  echo "    bash <(curl -fsSL https://raw.githubusercontent.com/PrudhommeWTF/Maison-De-Famille/main/deploy/lxc/install.sh)"
fi
echo "  Adresse obtenue :  pct exec ${CTID} -- hostname -I"
echo
