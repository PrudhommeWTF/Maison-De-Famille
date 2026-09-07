# Sécurité

Cette application est exposée sur Internet, et elle publie au même endroit
l'adresse de deux résidences, leurs codes d'accès, et le calendrier qui dit
exactement quand elles sont vides. Ce document dit ce qui est fait, ce qui ne
l'est pas, et pourquoi.

---

## Ce qui est en place

| Sujet | Décision | Où |
| --- | --- | --- |
| Mots de passe | **argon2id**, 64 Mio de mémoire, 3 passes. Coûteux en mémoire, donc résistant au calcul sur carte graphique, là où bcrypt ne coûte que du processeur. Calcul asynchrone : la route de connexion est publique, une version synchrone permettrait de figer le service pour toute la famille. | `auth/mots-de-passe.ts` |
| Politique | Douze caractères minimum, **et rien d'autre**. Les règles de complexité produisent des mots de passe plus faibles et plus oubliés. | idem |
| Jeton d'accès | JWT de 15 minutes, **algorithme vérifié explicitement** (`algorithms: ['HS256']`). Sans cette liste, un jeton déclarant `alg: none` passerait sur certaines bibliothèques. | `auth/jetons.ts` |
| Jeton de renouvellement | 30 jours, stocké **haché**, à rotation : il ne sert qu'une fois, ce qui rend un vol détectable. | idem |
| Révocation | `token_version` invalide d'un coup tous les jetons d'une personne (changement de mot de passe, compte archivé). | idem |
| Secret JWT | **Obligatoire au démarrage**, 32 caractères minimum, aucune valeur par défaut dans le code. Le service refuse de démarrer et dit où corriger. | `noyau/config.ts` |
| Temporisation | Deux compteurs : par compte visé (strict) et par adresse (généreux). Un attaquant change d'adresse mais pas de cible ; la famille peut sortir par la même adresse. Attente progressive. | `auth/temporisation.ts` |
| Énumération | Impossible : même message, même code, **même temps de réponse** pour un compte inconnu (un calcul argon2 factice est fait exprès). | `auth/routes.ts` |
| Second facteur | TOTP (RFC 6238) avec dix codes de secours. Rejeu refusé : le pas validé est enregistré. Activable par chacun, rendable obligatoire pour les gérants par un réglage. | `auth/totp.ts` |
| Autorisation | Centralisée. Chaque route déclare son exigence, les repos reçoivent la liste des biens autorisés et **filtrent en SQL**. Le serveur ne lit jamais ce qu'il n'a pas le droit de rendre. | `acces/`, `noyau/http.ts` |
| Fichiers | Servis derrière autorisation, identifiants de 128 bits non devinables, répertoire jamais exposé par le serveur web. L'autorisation se déduit du **rattachement** du fichier (photo de bien, justificatif de dépense, version d'un document du coffre avec sa portée, photo d'album) : un fichier sans rattachement connu n'est jamais servi, et un test le vérifie. Les images de l'interface passent donc par le client, avec le jeton, et non par une adresse nue. | `stockage/`, `core/fichiers.ts` |
| En-têtes | `helmet`, politique de sécurité de contenu stricte : `default-src 'self'`, aucun CDN. `upgrade-insecure-requests`, que helmet ajoute par défaut, est **retiré** : il rendait l'application inutilisable sur une instance servie en clair sur le réseau local, page blanche à la clé. C'est au reverse-proxy de rediriger vers https. Un test lit l'en-tête émis (`test/entetes.test.ts`), parce qu'un navigateur exempte « localhost » et ne révèle donc rien. | `server.ts` |
| Réseau sortant | **Aucun**, sauf le relais SMTP configuré. Polices et icônes sont dans le dépôt. Une exception **éteinte par défaut** : le réglage `vacancesTelechargement` autorise un appel vers `data.education.gouv.fr` pour récupérer le calendrier scolaire. Adresse en dur, hôte revérifié après redirection, temporisation de 20 s, taille plafonnée à 8 Mo, réservé aux gérants, et **aucune écriture sans confirmation humaine**. Allumer ce réglage oblige à rouvrir la sortie réseau du conteneur, et fait connaître l'existence de l'instance au portail. | `calendrier/telechargement.ts` |
| Validation | Chaque champ est lu par une fonction qui rend une valeur typée ou lève. Aucune concaténation de SQL, requêtes préparées partout. | `noyau/valider.ts` |
| Journal | Toute décision, tout passage en force sur un conflit, tout changement de parts est horodaté avec son auteur. | `journal_audit` |
| Invitation | Le gérant crée le compte, la personne **choisit son mot de passe elle-même** : aucun gérant ne connaît celui d'un autre. Lien valable sept jours, à usage unique, périmé dès qu'un nouveau est demandé. | `auth/invitations.ts` |
| Lien affiché en clair | Repli assumé pour le jour de l'installation, quand aucun relais SMTP n'est configuré. **Afficher le lien, c'est pouvoir choisir le mot de passe de quelqu'un d'autre** : réservé au gérant, daté en base (`vu_le`) et écrit au journal avec le nom de qui a regardé. | idem |
| Codes d'accès | Chiffrés au repos en **AES-256-GCM**. La clé (`MDF_CLE_COFFRE`) vit dans le fichier d'environnement, **hors du répertoire de données** : une base qui fuit ou une sauvegarde recopiée ne rend aucun code. Une racine sur la machine lit la clé comme le reste : c'est une frontière réelle, pas un coffre-fort. | `coffre/chiffrement.ts` |
| Portée des codes | Quatre portées. « Pendant le séjour » ouvre deux jours avant l'arrivée et se ferme **le lendemain du jour de départ**, jamais avant : il faut pouvoir refermer la maison. Un gérant et un détenteur ne dépendent pas d'un séjour. | `coffre/portee.ts` |
| Affichage d'un code | La liste ne porte **jamais** la valeur. Chaque affichage passe par une route qui déchiffre et journalise dans la même transaction, avec le nom et l'horodatage. | `coffre/repo.ts`, `code_affichage` |
| Accès temporaire | Un lien d'invité ouvre une personne sans mot de passe et un rôle **daté**. Deux verrous indépendants : le jeton n'ouvre plus de session passé la date, et la fin du rôle coupe les sessions déjà ouvertes. La révocation ajoute le troisième : jetons d'accès et de renouvellement invalidés sur-le-champ. | `acces/temporaire.ts` |
| Compte par lien | `acces_lien_seul` empêche un locataire de se transformer en compte permanent par « mot de passe oublié ». La réponse de cette route reste identique : aucune énumération. | `auth/routes.ts` |
| Deux gérants par structure | Le serveur refuse tout retrait qui ferait descendre sous deux, y compris pour soi-même. Une structure à gérant unique est une instance dont l'accès se perd avec un téléphone, et dont la seule issue est une restauration. | `acces/gouvernance.ts` |

## Ce que la CI vérifie, à chaque poussée

- **Recherche de secrets** avant qu'ils n'entrent dans l'historique. Un secret
  commité est compromis même retiré ensuite : le seul moment pour l'attraper est
  avant.
- **Portée d'accès** : une route qui porte un bien dans son adresse sans exiger
  de portée de bien fait échouer la CI. Une route publique hors de la liste
  explicitement autorisée aussi. Un séjour désigné hors du chemin de son bien
  également.
- **Refus réel** : un détenteur d'un bien se voit refuser chaque route de
  l'autre bien, y compris en tapant l'adresse directement.
- **Audit des dépendances** de production, bloquant à partir de « high ».
- **Parcours d'inscription complet**, des routes jusqu'à la connexion effective :
  créer une personne, recevoir l'invitation, choisir un mot de passe, se
  connecter. Le contournement de ce parcours dans le banc d'essai avait laissé
  passer un défaut qui le rendait entièrement inopérant.
- **Seuils de majorité** : le seuil exact, l'arrondi au supérieur, l'abstention,
  le quorum, un détenteur sorti pendant le scrutin, et l'absence de vote en nom
  propre.
- **Portée du coffre-fort**, cas par cas : la veille, pendant, le jour du départ
  et le lendemain, pour chacun des quatre rôles, avec les rotations le même jour
  et les séjours à cheval sur le changement d'année.
- **Discipline de validation** : un champ lu sans `fin()` acceptait une valeur
  invalide en silence. La CI compte les lectures et les clôtures de chaque
  fichier de routes.

---

## Ce qui n'est pas fait, et pourquoi

**Le chiffrement de la base au repos.** SQLite chiffré demanderait SQLCipher,
donc une compilation native, donc un binaire de plus à maintenir. La protection
réelle vient du chiffrement du disque du conteneur, qui est de votre ressort et
protège aussi les sauvegardes. Les codes d'accès, eux, seront chiffrés
individuellement en tranche 3, parce qu'ils méritent une protection même si la
base fuit.

**La limitation du nombre de sessions par personne.** Une famille se connecte
depuis un téléphone, une tablette et un ordinateur : borner serait gênant sans
rien protéger.

**Un pare-feu applicatif.** C'est le rôle du reverse-proxy, et le dupliquer dans
l'application n'ajouterait rien.

---

## Ce qui vous incombe

1. **Le certificat et le HSTS** sur NGINX Proxy Manager. L'application ne fait
   pas de redirection HTTPS elle-même : elle ne sait pas sous quel nom elle est
   servie.
2. **Le chiffrement du disque** du conteneur, ou du pool ZFS qui le porte.
3. **La sortie des sauvegardes** hors de la machine. Une sauvegarde sur le même
   disque ne protège que des erreurs humaines.
4. **Un mot de passe d'application dédié** pour le relais SMTP, jamais le mot de
   passe principal de la boîte.
5. **Les mises à jour** : `git pull && bash deploy/lxc/install.sh` relance
   l'audit des dépendances au passage.

---

## En cas de doute sur une compromission

```bash
# 1. Fermer toutes les sessions, immédiatement.
sqlite3 /var/lib/maison-de-famille/maison.db \
  "UPDATE personne SET token_version = token_version + 1;
   UPDATE session SET revoque_le = datetime('now') WHERE revoque_le IS NULL;"

# 2. Changer le secret JWT et redémarrer (déconnecte tout le monde).
openssl rand -hex 32
nano /etc/maison-de-famille/mdf.env
systemctl restart maison-de-famille

# 3. Regarder qui s'est connecté, et depuis où.
sqlite3 /var/lib/maison-de-famille/maison.db \
  "SELECT p.nom, s.cree_le, s.adresse_ip, s.agent
   FROM session s JOIN personne p ON p.id = s.personne_id
   ORDER BY s.cree_le DESC LIMIT 40;"

# 4. Relire le journal des actions sensibles.
sqlite3 /var/lib/maison-de-famille/maison.db \
  "SELECT fait_le, action, objet_kind, objet_id, acteur_id
   FROM journal_audit ORDER BY id DESC LIMIT 60;"
```

Puis demandez à chacun de choisir un nouveau mot de passe par le lien « mot de
passe oublié ».
