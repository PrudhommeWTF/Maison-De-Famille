#!/usr/bin/env bash
# ============================================================
# Maison de Famille : mise à jour depuis l'interface, EXÉCUTÉE EN ROOT.
#
# Déclenchée par l'unité `maison-de-famille-maj.path` lorsque le service crée le
# fichier ${DATA_DIR}/.maj-declencheur. À ne pas lancer à la main d'ordinaire :
# pour une mise à jour manuelle, relancez simplement install.sh.
#
# Pourquoi ce détour par root : le service tourne sous un compte sans privilège,
# avec `ProtectSystem=strict` et le seul droit d'écrire dans son répertoire de
# données. Il ne peut donc ni remplacer son propre code, ni se redémarrer, et
# c'est voulu. Il dépose un fichier, root fait le travail. Le jour où quelqu'un
# obtiendrait l'exécution de code dans le service, il ne récupérerait pas la
# machine avec.
#
# La progression est écrite dans ${DATA_DIR}/maj-etat.json, que l'interface lit.
# Un état « en cours » qui cesse de progresser est traité comme un échec au bout
# d'un quart d'heure, côté application : voir backend/src/systeme/versions.ts.
# ============================================================
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/maison-de-famille}"
ENV_FILE="${ENV_FILE:-/etc/maison-de-famille/mdf.env}"
UNITE="maison-de-famille"
SERVICE_USER="maison"
# shellcheck disable=SC1090
DATA_DIR="$( ( . "$ENV_FILE" 2>/dev/null; echo "${MDF_DATA_DIR:-/var/lib/maison-de-famille}" ) )"
# shellcheck disable=SC1090
DEPOT="$( ( . "$ENV_FILE" 2>/dev/null; echo "${MDF_DEPOT_GITHUB:-PrudhommeWTF/Maison-De-Famille}" ) )"
# Le service s'en sert déjà pour interroger GitHub. Le téléchargement l'ignorait
# dans Foyer-App, si bien qu'un dépôt privé passait la vérification puis
# échouait à l'installation sur une demande d'identifiants. Jamais journalisé :
# le journal remonte à l'interface. shellcheck disable=SC1090
JETON="$( ( . "$ENV_FILE" 2>/dev/null; echo "${MDF_GITHUB_TOKEN:-}" ) )"

ETAT="${DATA_DIR}/maj-etat.json"
JOURNAL="${DATA_DIR}/maj.log"
TMP="$(mktemp -d)"

# Aucune invite d'identifiants : sans terminal, git resterait bloqué à attendre
# une saisie qui ne viendra jamais. Un dépôt injoignable doit échouer tout de
# suite, et le dire.
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/true
export NG_CLI_ANALYTICS=false DEBIAN_FRONTEND=noninteractive

ETAPE="Préparation"
ARRETE=0
DEBUT_JOURNAL=0
[ -f "$JOURNAL" ] && DEBUT_JOURNAL="$(wc -l < "$JOURNAL")"

# printf n'échappe rien : un guillemet dans un message de git ou de npm
# produirait un JSON invalide, donc une interface qui n'affiche plus rien du
# tout. Sur une ligne, sans caractère de contrôle, tronqué AVANT l'échappement
# (couper après pourrait sectionner un « \" » et casser le JSON), puis repassé
# par iconv pour ne pas laisser un caractère accentué coupé en deux.
json() {
  printf '%s' "$1" | tr '\n\r\t' '   ' | tr -d '\000-\037' | head -c 250 \
    | iconv -c -f UTF-8 -t UTF-8 | sed 's/\\/\\\\/g; s/"/\\"/g'
}
etat() {
  printf '{"etat":"%s","message":"%s","ts":%s000}\n' "$1" "$(json "$2")" "$(date +%s)" > "$ETAT"
  chown "${SERVICE_USER}:${SERVICE_USER}" "$ETAT" 2>/dev/null || true
}
etape() { ETAPE="$1"; etat en_cours "$2"; }
menage() { rm -rf "$TMP"; rm -f "${DATA_DIR}/.maj-declencheur"; }

# « Échec de la mise à jour » tout court oblige à ouvrir un terminal pour savoir
# quoi que ce soit. On remonte donc l'étape ET la dernière ligne du journal, qui
# est presque toujours le message de la commande qui a lâché.
echouer() {
  trap - ERR
  local derniere pourquoi
  # Uniquement les lignes de CETTE exécution, et pas nos propres bannières :
  # remonter la dernière ligne de la mise à jour précédente serait un mensonge.
  derniere="$(tail -n "+$((DEBUT_JOURNAL + 1))" "$JOURNAL" 2>/dev/null \
    | grep -vE '^[[:space:]]*$|^=+$|^\[.*\] (Mise à jour|ECHEC)' | tail -n1)"
  pourquoi="${1:-Échec pendant « ${ETAPE} »}"
  echo "[$(date)] ECHEC: ${pourquoi} | ${derniere}"
  etat echec "${pourquoi} : ${derniere:-voir ${JOURNAL}}"
  # Un échec après l'arrêt du service doit le relancer, jamais laisser
  # l'application morte parce qu'une compilation a raté.
  if [ "$ARRETE" = 1 ]; then
    echo "Redémarrage du service après échec"
    systemctl start "$UNITE" || true
  fi
  menage
  exit 1
}
trap echouer ERR

mkdir -p "$DATA_DIR"
exec >>"$JOURNAL" 2>&1
echo "=========================================="
echo "[$(date)] Mise à jour Maison de Famille, début"
rm -f "${DATA_DIR}/.maj-declencheur"
etape "Recherche de la dernière version" "Recherche de la dernière version…"

entetes=(); gitc=()
if [ -n "$JETON" ]; then
  entetes=(-H "Authorization: Bearer ${JETON}")
  # En-tête plutôt qu'identifiants dans l'URL : git recopie l'URL dans ses
  # messages d'erreur, et ces messages finissent dans le journal.
  gitc=(-c "http.extraHeader=Authorization: Bearer ${JETON}")
fi
# Un coup de réseau raté ne doit pas coûter une mise à jour : curl réessaie.
api() {
  curl -fsSL --retry 3 --retry-delay 2 --retry-connrefused --connect-timeout 15 \
       -H 'User-Agent: Maison-de-Famille' "${entetes[@]}" "$1" 2>/dev/null || true
}
TAG="$(api "https://api.github.com/repos/${DEPOT}/releases/latest" | grep -oP '"tag_name":\s*"\K[^"]+' | head -n1 || true)"
if [ -z "$TAG" ]; then
  TAG="$(api "https://api.github.com/repos/${DEPOT}/tags?per_page=100" | grep -oP '"name":\s*"\Kv?[0-9][^"]*' | sort -V | tail -n1 || true)"
fi
[ -n "$TAG" ] || echouer "Impossible de déterminer la dernière version. GitHub est-il joignable depuis ce serveur ?"
echo "Dernière version : $TAG"

etape "Téléchargement du code" "Téléchargement de la version ${TAG}…"
# L'archive d'abord : un simple GET, qui ne peut pas se transformer en dialogue
# d'authentification. git clone reste en secours (dépôt sans archive, miroir).
if [ -n "$JETON" ]; then SOURCE="https://api.github.com/repos/${DEPOT}/tarball/${TAG}"
else SOURCE="https://codeload.github.com/${DEPOT}/tar.gz/refs/tags/${TAG}"; fi
archive() {
  rm -rf "$TMP/src"; mkdir -p "$TMP/src"
  curl -fsSL --retry 3 --retry-delay 3 --retry-connrefused --connect-timeout 15 \
       -H 'User-Agent: Maison-de-Famille' "${entetes[@]}" "$SOURCE" | tar -xz -C "$TMP/src" --strip-components=1
}
cloner() {
  rm -rf "$TMP/src"
  git "${gitc[@]}" clone --depth 1 --branch "$TAG" "https://github.com/${DEPOT}.git" "$TMP/src"
}
archive || cloner || echouer "Téléchargement de ${TAG} impossible"
[ -f "$TMP/src/backend/package.json" ] || echouer "L'archive ${TAG} est incomplète"
[ -f "$TMP/src/frontend/package.json" ] || echouer "L'archive ${TAG} est incomplète"

# Ce script vit hors de $APP_DIR : la mise à jour ne recopierait donc que le
# code de l'application et laisserait CE script dans la version posée par
# install.sh, pour toujours. Autrement dit, aucune correction du script de mise
# à jour ne pourrait jamais atteindre une machine autrement qu'à la main.
#
# **Ici et non à la fin, et c'est le point.** Tant que ce remplacement suivait la
# compilation, un assistant qui échouait avant elle ne pouvait pas se réparer :
# il rejouait éternellement son propre défaut, et il fallait un accès au serveur.
# C'est exactement ce qui est arrivé avec « tsc: not found ». Posé juste après le
# téléchargement, dont l'archive vient d'être contrôlée, le correctif d'un
# assistant cassé arrive à la tentative suivante. On n'y perd rien : sur une mise
# à jour qui réussit, cet assistant-là aurait de toute façon été installé.
#
# Remplacement par renommage et non par écrasement : bash lit son propre fichier
# au fur et à mesure de l'exécution, réécrire celui qui tourne lui ferait
# exécuter n'importe quoi. La version posée ici servira la prochaine fois.
ASSISTANT=/usr/local/sbin/maison-de-famille-maj.sh
NEUF="$TMP/src/deploy/lxc/maj.sh"
if [ -f "$ASSISTANT" ] && [ -f "$NEUF" ] && ! cmp -s "$NEUF" "$ASSISTANT"; then
  install -m 0755 -o root -g root "$NEUF" "${ASSISTANT}.nouveau" && mv -f "${ASSISTANT}.nouveau" "$ASSISTANT"
  echo "Assistant de mise à jour actualisé : ${ASSISTANT}"
fi

# `--include=dev` sur les deux compilations, et il n'est pas décoratif.
#
# L'unité systemd de la mise à jour lit le fichier d'environnement du service,
# qui contient `NODE_ENV=production`. Or npm en déduit `omit=dev` et saute les
# dépendances de développement : `tsc` et le compilateur Angular n'étaient pas
# installés, et la mise à jour depuis l'interface échouait sur
# « sh: 1: tsc: not found ». En ligne de commande, où NODE_ENV n'est pas posé,
# le même script marchait, ce qui rendait la panne difficile à croire.
#
# `--include=dev` gagne sur `omit` quel que soit l'ordre : c'est ce que dit npm,
# et c'est ce qu'on veut ici, sans dépendre de l'environnement du service.
etape "Compilation du serveur" "Compilation du serveur…"
npm --prefix "$TMP/src/backend" ci --include=dev
npm --prefix "$TMP/src/backend" run build
etape "Compilation de l'application" "Compilation de l'application…"
npm --prefix "$TMP/src/frontend" ci --include=dev
npm --prefix "$TMP/src/frontend" run build
[ -d "$TMP/src/frontend/dist/frontend/browser" ] || echouer "La compilation de l'application n'a rien produit"

# Tout est compilé avant qu'on touche à l'installation en place : une
# compilation qui rate ne doit pas laisser un service à moitié remplacé.
etape "Installation" "Installation…"
systemctl stop "$UNITE" || true
ARRETE=1
rsync -a --delete --exclude 'node_modules' "$TMP/src/backend/" "${APP_DIR}/backend/"
# Ici `--omit=dev` est voulu : on ne laisse pas un compilateur et ses cent
# paquets sur la machine de la famille. C'est l'inverse des deux lignes de
# compilation plus haut, et c'est normal.
npm --prefix "${APP_DIR}/backend" ci --omit=dev
rm -rf "${APP_DIR}/frontend/dist"
mkdir -p "${APP_DIR}/frontend/dist"
cp -r "$TMP/src/frontend/dist/." "${APP_DIR}/frontend/dist/"
# Les scripts de déploiement font partie de la version : sans cette copie, une
# correction de sauvegarde.sh ou de restauration.sh n'atteindrait jamais une
# machine déjà installée.
rsync -a "$TMP/src/deploy/" "${APP_DIR}/deploy/" 2>/dev/null || true

# La version déployée est enregistrée dans le fichier d'environnement, relu au
# redémarrage du service. C'est elle que l'écran « État du service » affiche.
if grep -q '^MDF_VERSION=' "$ENV_FILE"; then
  sed -i "s|^MDF_VERSION=.*|MDF_VERSION=${TAG#v}|" "$ENV_FILE"
else
  echo "MDF_VERSION=${TAG#v}" >> "$ENV_FILE"
fi
chown -R root:root "$APP_DIR"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$DATA_DIR"

# Les unités systemd font partie de la version, au même titre que le code.
#
# Tant que seul install.sh les écrivait, la mise à jour ne faisait qu'arrêter et
# relancer : une correction dans une définition d'unité n'atteignait jamais une
# machine autrement qu'en y ouvrant un terminal. C'est la même impasse que
# l'assistant qui ne pouvait pas se réparer, un étage au-dessus.
#
# Chargées depuis l'archive qu'on vient d'installer, donc à la version qu'on
# installe. En cas d'absence (mise à jour vers une version antérieure à ce
# fichier), on ne touche à rien : les unités en place ont déjà fait démarrer ce
# service, et les réécrire n'est jamais aussi urgent que le redémarrer.
UNITES="$TMP/src/deploy/lxc/unites.sh"
if [ -f "$UNITES" ]; then
  etape "Mise à jour des unités systemd" "Mise à jour des unités systemd…"
  # `true` en dur, et sur sa propre ligne. Ce script ne tourne que parce que la
  # mise à jour depuis l'interface est activée : c'est son unité `path` qui l'a
  # lancé. Surtout, la branche « éteinte » de `ecrire_unites` supprime
  # /usr/local/sbin/maison-de-famille-maj.sh, c'est-à-dire le fichier en train
  # de s'exécuter. On ne lui laisse pas l'occasion d'y passer.
  MAJ_AUTO=true
  # shellcheck source=/dev/null
  . "$UNITES"
  ecrire_unites
  echo "Unités systemd réécrites depuis ${TAG}"
else
  echo "Pas de unites.sh dans ${TAG} : unités laissées en l'état."
fi

etape "Redémarrage du service" "Redémarrage du service…"
systemctl start "$UNITE"
ARRETE=0

# Les migrations de schéma s'appliquent au démarrage, dans une transaction, et
# après une sauvegarde automatique déposée dans <données>/sauvegardes/. Il n'y a
# donc rien à faire ici : c'est le service lui-même qui s'en charge, et qui
# refuse de démarrer plutôt que d'abîmer les données.
etat termine "Version ${TAG} installée."
echo "[$(date)] Mise à jour terminée : $TAG"
menage
