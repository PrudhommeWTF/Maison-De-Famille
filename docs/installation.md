# Installation

Deux façons de déployer, au choix. Les deux servent la même image : un seul
processus qui rend l'API et l'application, sur un seul port.

Dans les deux cas, l'application écoute **sur toutes les interfaces**, port 8099.
C'est ce qui permet d'ouvrir l'écran de premier démarrage en tapant l'adresse du
conteneur, avant même qu'un reverse-proxy existe. Une fois le proxy en place sur
la même machine, `MDF_HOST=127.0.0.1` ferme l'accès direct au port ; sur une
machine séparée, c'est au pare-feu de le faire.

La mise en ligne passe de toute façon par le reverse-proxy, qui porte le
certificat : l'application ne fait pas de TLS elle-même.

---

## LXC natif sous Proxmox

### 1. Créer le conteneur, depuis l'hôte Proxmox

```bash
git clone https://github.com/PrudhommeWTF/Maison-De-Famille.git /tmp/mdf
bash /tmp/mdf/deploy/lxc/proxmox-create.sh
```

Un conteneur Debian 12 **non privilégié** est créé (2 vCPU, 1 Go, 8 Go de
disque), démarré au boot. Ces valeurs se règlent par variables d'environnement :

```bash
CTID=210 MEMOIRE=2048 DISK=12 STORAGE=local-zfs bash deploy/lxc/proxmox-create.sh
```

### 2. Installer, dans le conteneur

```bash
pct enter 210
bash <(curl -fsSL https://raw.githubusercontent.com/PrudhommeWTF/Maison-De-Famille/main/deploy/lxc/install.sh)
```

Le script installe Node 22, compile le backend et l'application, crée
l'utilisateur de service `maison`, engendre un secret JWT, écrit l'unité systemd
et démarre le service. Il est **idempotent** : le relancer met à jour le code
sans toucher aux données.

### 3. Renseigner la configuration

```bash
nano /etc/maison-de-famille/mdf.env
systemctl restart maison-de-famille
```

Deux valeurs sont à remplir avant que la famille s'en serve :

| Variable | Pourquoi |
| --- | --- |
| `MDF_PUBLIC_URL` | L'adresse que la famille tape. Les liens des courriels sont absolus : sans elle, ils seraient inutilisables. |
| `MDF_SMTP_*` | Le relais qui porte les courriels. Sans lui, les notifications sont enregistrées mais ne partent pas, et l'écran d'état le dit. |

### Commandes courantes

```bash
systemctl status maison-de-famille
systemctl restart maison-de-famille
journalctl -f -u maison-de-famille              # suivre le journal
journalctl -u maison-de-famille --since "1 hour ago"
```

---

## Docker

```bash
git clone https://github.com/PrudhommeWTF/Maison-De-Famille.git
cd Maison-De-Famille
cp .env.exemple .env
openssl rand -hex 32                            # à coller dans MDF_JWT_SECRET
nano .env
docker compose up -d --build
```

```bash
docker compose logs -f
docker compose restart
docker compose down                              # les données restent dans ./data
```

---

## Le reverse-proxy

Sur NGINX Proxy Manager, un hôte mandataire suffit :

| Champ | Valeur |
| --- | --- |
| Domaine | `maison.exemple.fr` |
| Schéma | `http` |
| Hôte | l'adresse IP du conteneur |
| Port | `8099` |
| Websockets | inutile, l'application n'en ouvre pas |
| SSL | certificat Let's Encrypt, **Force SSL** activé, HSTS activé |

Dans l'onglet **Advanced**, une seule directive est utile :

```nginx
# Sans cela, toute la famille partage la même adresse aux yeux de la
# temporisation de connexion, et un seul essai malheureux verrouille tout
# le monde. L'application fait déjà confiance à un proxy (trust proxy 1).
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP $remote_addr;

# Les téléversements de photos : la limite par défaut de NGINX est de 1 Mo.
client_max_body_size 20m;
```

**Servir sous un sous-chemin** (`https://exemple.fr/maison/`) demande une
variable de plus, sinon le navigateur cherche les fichiers de l'application à la
racine du domaine :

```
MDF_BASE_HREF=/maison/
```

---

## Vérifier que tout va bien

```bash
curl -s http://127.0.0.1:8099/api/sante          # {"ok":true,"version":"..."}
```

Puis, connecté en gérant, l'écran **État du service** montre d'un coup d'oeil la
version du schéma, le relais SMTP et la file des courriels en attente avec
l'erreur exacte du relais. C'est le premier endroit à regarder quand quelqu'un
dit « je n'ai rien reçu ».

---

## Mettre à jour

En LXC, on **relance l'installateur** : il reclone la dernière version, la
recompile et redémarre le service, sans toucher aux données ni à la
configuration.

```bash
# LXC
bash <(curl -fsSL https://raw.githubusercontent.com/PrudhommeWTF/Maison-De-Famille/main/deploy/lxc/install.sh)

# Docker (depuis votre clone du dépôt)
git pull && docker compose up -d --build
```

Un `git pull` dans `/opt/maison-de-famille` ne marche pas et ne marchera jamais :
l'installateur y copie le code **sans le dossier `.git`**, pour ne pas laisser
l'historique complet du dépôt sur une machine exposée. La commande répondrait
`fatal: not a git repository`.

Les migrations de schéma s'appliquent au démarrage, dans une transaction, après
une **sauvegarde automatique** déposée dans `<données>/sauvegardes/`. Si la base
porte une version que le binaire ne connaît pas (déploiement en arrière), le
service refuse de démarrer et dit quoi faire, au lieu d'abîmer les données.
