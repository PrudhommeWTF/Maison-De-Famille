# Sauvegarde et restauration

Ce qu'il faut sauvegarder tient en un répertoire : `/var/lib/maison-de-famille`
en LXC, `./data` en Docker. Il contient la base SQLite, les pièces jointes, et
les sauvegardes automatiques prises avant chaque migration.

**Une base SQLite ne se copie pas avec `cp` pendant que le service tourne.** Le
journal WAL contient les dernières écritures : la copie s'ouvrira sans erreur,
et il lui manquera des données. C'est le piège classique, et c'est pour cela que
les scripts ci-dessous passent par `VACUUM INTO`.

---

> **La clé du coffre-fort ne vit pas dans le répertoire de données.**
> `MDF_CLE_COFFRE` est dans `/etc/maison-de-famille/mdf.env`, volontairement à
> l'écart : c'est ce qui fait qu'une sauvegarde des données recopiée sur un NAS
> ne contient aucun code d'accès. La contrepartie est qu'une restauration sur
> une machine neuve **sans reporter cette clé** rend tout, sauf les codes.
> Sauvegardez-la séparément, une fois, le jour de l'installation.
>
> ```bash
> grep MDF_CLE_COFFRE /etc/maison-de-famille/mdf.env
> ```

## Sauvegarder

```bash
bash /opt/maison-de-famille/deploy/lxc/sauvegarde.sh
```

Le script produit une archive unique dans `<données>/sauvegardes/`, contenant la
base (copie cohérente) et toutes les pièces jointes. **Le service n'a pas besoin
d'être arrêté.** Quatorze archives sont conservées, réglable par `GARDER`.

En Docker :

```bash
docker compose exec maison-de-famille \
  node -e "require('better-sqlite3')('/data/maison.db').prepare('VACUUM INTO ?').run('/data/sauvegardes/maison-$(date +%F).db')"
tar -czf maison-$(date +%F).tar.gz -C ./data sauvegardes/maison-$(date +%F).db fichiers
```

Ou, plus simplement, depuis l'application : **Administration**, section « Données », propose
« Export complet de l'instance », qui produit la même archive.

### Automatiser

```bash
cat > /etc/systemd/system/maison-de-famille-sauvegarde.service <<'EOF'
[Unit]
Description=Sauvegarde de Maison de Famille
[Service]
Type=oneshot
ExecStart=/bin/bash /opt/maison-de-famille/deploy/lxc/sauvegarde.sh
EOF

cat > /etc/systemd/system/maison-de-famille-sauvegarde.timer <<'EOF'
[Unit]
Description=Sauvegarde quotidienne de Maison de Famille
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now maison-de-famille-sauvegarde.timer
systemctl list-timers maison-de-famille-sauvegarde.timer
```

`Persistent=true` rattrape la sauvegarde manquée si le conteneur était éteint à
3 h 30.

### La sortir de la machine

Une sauvegarde qui reste sur le même disque ne protège que des erreurs
humaines. Copiez-la ailleurs :

```bash
rsync -a /var/lib/maison-de-famille/sauvegardes/ nas:/sauvegardes/maison/
```

---

## Restaurer

```bash
systemctl stop maison-de-famille
bash /opt/maison-de-famille/deploy/lxc/restauration.sh /chemin/sauvegarde.tar.gz
systemctl start maison-de-famille
journalctl -f -u maison-de-famille
```

Le script **refuse de tourner pendant que le service tourne** : restaurer sous
une base ouverte donnerait une base corrompue et une panne difficile à
comprendre. Il vérifie l'intégrité de l'archive avant de toucher à quoi que ce
soit, et **met l'état actuel de côté** dans `<données>.remplace-<horodatage>` :
une restauration lancée par erreur se défait.

Il accepte les deux formes d'archive : celle du script de sauvegarde, et celle
produite par l'export complet depuis l'application.

---

## Repartir de zéro sur une machine neuve

C'est le point de recette « j'exporte tout, je restaure sur une instance vierge,
je retrouve la même chose ».

```bash
# 1. Sur l'ancienne machine
bash deploy/lxc/sauvegarde.sh /tmp
scp /tmp/maison-de-famille-*.tar.gz nouvelle-machine:/tmp/

# 2. Sur la nouvelle
bash deploy/lxc/install.sh
systemctl stop maison-de-famille
bash /opt/maison-de-famille/deploy/lxc/restauration.sh /tmp/maison-de-famille-*.tar.gz
systemctl start maison-de-famille
```

Le secret JWT de la nouvelle machine est différent : tout le monde devra se
reconnecter une fois. Les mots de passe, eux, sont dans la base restaurée et
restent valables. Pour éviter même cette reconnexion, recopiez `MDF_JWT_SECRET`
depuis l'ancien `/etc/maison-de-famille/mdf.env`.

---

## Vérifier une sauvegarde

Une sauvegarde jamais restaurée n'est pas une sauvegarde. Deux minutes, une fois
par trimestre :

```bash
ARCHIVE=/var/lib/maison-de-famille/sauvegardes/maison-de-famille-20260905-033000.tar.gz

tar -tzf "${ARCHIVE}" | head                     # l'archive s'ouvre
mkdir /tmp/verif && tar -xzf "${ARCHIVE}" -C /tmp/verif
sqlite3 /tmp/verif/maison.db "PRAGMA integrity_check"        # doit rendre « ok »
sqlite3 /tmp/verif/maison.db "SELECT COUNT(*) FROM sejour"   # doit ressembler à la réalité
rm -rf /tmp/verif
```

---

## Ce que contient le répertoire de données

```
/var/lib/maison-de-famille/
├── maison.db              la base : tout sauf les octets des fichiers
├── maison.db-wal          journal d'écriture, absorbé au prochain arrêt propre
├── maison.db-shm          index partagé du journal
├── fichiers/aa/bb/…       les pièces jointes, adressées par leur empreinte
└── sauvegardes/           automatiques avant migration, et celles du script
```

Les fichiers sont adressés par l'empreinte de leur contenu : deux dépôts du même
PDF ne coûtent qu'une copie, et un fichier ne peut pas se retrouver au mauvais
endroit à cause d'un nom.
