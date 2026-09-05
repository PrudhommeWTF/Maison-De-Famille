# Plan des tranches

Une tranche se déploie. Elle n'est pas finie tant qu'elle ne tourne pas en production, avec de
vraies données, et que vous n'avez pas passé sa recette. La priorité 2 ne commence pas avant que
la priorité 1 ait reçu le vrai planning.

Chaque tranche se termine par : un tag Git, une note de version, un fichier
`docs/recette-tN.md`, et **une phrase disant ce que vous devez vérifier vous-même**.

---

## Tranche 1 : remplacer le fichier Excel (**livrée**)

C'est la seule tranche qui compte tant qu'elle n'est pas faite.

**Socle** (dedans, pas à côté) : dépôt, CI, image Docker, installation LXC sous systemd,
migrations numérotées, journalisation, service de fichiers, registre de paramètres, contrat de
tuile, file de notifications, écran d'état système, sauvegarde et restauration documentées.

**Sécurité** : argon2id, JWT à secret obligatoire, temporisation de connexion sans énumération,
TOTP disponible, module `acces` et son test de portée exhaustif. Tout, dès maintenant.

**Fonctionnel** :

- comptes, mot de passe oublié, foyers, rôles par structure ;
- structures (indivision, SCI, nom propre) avec leurs règles de décision en table ;
- biens, fiche minimale, ajout et archivage réversible en deux temps ;
- détentions historisées et l'écran de saisie d'un changement de parts avec date d'effet ;
- calendrier d'occupation mensuel, aux couleurs et à la convention de nuits de la maquette ;
- demandes de séjour, détection de conflit **avant l'envoi** et dans la file de la gérante ;
- arbitrage : valider, proposer d'autres dates, annuler une décision ;
- saisie directe d'un séjour par la gérante, en deux gestes ;
- tour de choix saisonnier avec voeux et quotas indicatifs (l'onglet de la maquette) ;
- import du planning Excel avec correspondance de colonnes, simulation et rapport ;
- notifications `demande_nouvelle` et `demande_decidee` ;
- tableau de bord portefeuille et dossier de bien, avec les tuiles séjours ;
- les trois écrans mobiles ;
- export CSV des séjours, export complet de l'instance.

**Hors tranche 1, volontairement** : dépenses, soldes, coffre-fort, votes, location, albums. Les
entrées de navigation correspondantes ne sont pas affichées tant qu'elles ne font rien. Pas d'UI
coquille.

**Ce que vous vérifiez vous-même** : votre mère se connecte seule, voit le calendrier des deux
biens, et comprend l'écran sans explication ; vous demandez un séjour qui chevauche, le conflit
apparaît avant l'envoi et dans sa file ; elle valide, vous recevez le courriel, le calendrier est
à jour pour tout le monde.

---

## Tranche 2 : l'argent (**livrée**)

- catégories et règles de répartition **datées**, la pastille cyclable écrivant une nouvelle
  ligne au lieu d'écraser ;
- saisie d'une dépense avec justificatif (photo ou PDF), dépense commune à plusieurs biens ;
- ventilation calculée à la saisie et **gelée**, avec la justification complète stockée ;
- l'explication du calcul en un clic, sur chaque montant affiché, partout ;
- recalcul explicite avec motif obligatoire et conservation de l'ancienne ventilation ;
- soldes par personne et par foyer, calculés, jamais stockés ;
- virements proposés en nombre minimal, avec le cycle proposé, annoncé, confirmé ;
- appel de fonds avec le détail par foyer ;
- vocabulaire suivant la structure : régularisation d'indivision d'un côté, comptes courants
  d'associés et appels de fonds de l'autre ;
- notification `appel_de_fonds` ;
- export CSV des dépenses avec la ventilation en colonnes.

**Ce que vous vérifiez vous-même** : vous saisissez la taxe foncière, la répartition suit les
quotes-parts et vous pouvez afficher le détail du calcul ; vous modifiez ensuite une quote-part
avec une date d'effet dans le passé, et cette dépense garde sa ventilation d'origine.
La liste complète est dans `docs/recette-t2.md`.

**Une décision prise en chemin** : une dépense qui sert à deux structures s'enregistre en deux
dépenses, une par structure. L'application le refuse explicitement et dit pourquoi. L'argent est
dû dans deux pots distincts, et une dépense de SCI n'entre jamais dans les comptes de
l'indivision : une écriture unique aurait donné des soldes que personne n'aurait su expliquer.
Le regroupement à l'affichage est prévu au schéma (`depense_groupe`).

---

## Tranche 1.5 : inscrire la famille (**livrée**)

Une correction, pas une nouvelle fonction. La tranche 1 avait livré la moitié
serveur de la gestion des personnes sans l'écran qui va avec : une gérante
fraîchement installée restait seule et ne pouvait inscrire personne. Le plan
renvoyait l'écran Membres à la tranche 4, ce qui aurait laissé l'application
inutilisable par la famille pendant deux tranches entières.

- écran **Personnes et rôles** : créer une personne, la rattacher à un foyer,
  attribuer et retirer un rôle sur une structure ;
- **parcours d'invitation** : la personne choisit son mot de passe elle-même, le
  gérant ne le connaît jamais. Il ne fonctionnait pas : « mot de passe oublié »
  excluait les comptes sans empreinte, c'est-à-dire exactement ceux qui venaient
  d'être créés ;
- **repli sans relais de courriel** : le lien d'invitation s'affiche en clair,
  son affichage est daté en base et journalisé, et chaque demande périme le
  lien précédent ;
- **second gérant obligatoire** : le serveur refuse tout retrait qui ferait
  descendre une structure sous deux gérants, et la carte de démarrage le
  signale tant que ce n'est pas fait ;
- **carte « Pour démarrer »** sur le tableau de bord, qui dit par où commencer
  et s'efface étape par étape ;
- suppression des sept tirets cadratins de l'interface, avec un test de CI qui
  les refuse désormais.

**Ce que vous vérifiez vous-même** : la liste complète est dans
`docs/recette-t15.md`. En une phrase, votre mère installe l'instance, inscrit la
fratrie, et chacun choisit son mot de passe et se connecte.

---

## Tranche 3 : la maison (**livrée**)

- carnet d'entretien, tâches, récurrences engendrant leurs échéances ;
- **carnet d'adresses** du bien : artisans, voisins, mairie, contacts d'urgence.
  Cinq champs, une carte dans la fiche du bien, portée « membres ». Utile le
  jour où la chaudière lâche pendant le séjour de quelqu'un qui ne connaît pas
  le plombier. C'est la seule fonction du service de référence que le brief
  n'avait pas listée et qui méritait d'être reprise ;
- cocher une tâche demande la date et accepte une facture, qui peut créer la dépense ;
- checklist de départ et sa notification la veille de la fin de séjour ;
- fiche complète du bien : caractéristiques, guide d'arrivée, inventaire, signalement de casse ;
- coffre-fort : documents versionnés avec portée, codes chiffrés au repos, journal de chaque
  affichage, et la portée `sejour` qui coupe l'accès à la fin du séjour.

**Ce que vous vérifiez vous-même** : un membre de foyer voit le guide d'arrivée mais pas la
convention d'indivision ; un code de portail affiché pendant un séjour ne l'est plus le
lendemain de son départ, et vous retrouvez qui l'a affiché et quand.
La liste complète est dans `docs/recette-t3.md`.

**Une décision prise en chemin** : les codes sont chiffrés (AES-256-GCM), les documents ne le
sont pas. Un code tient en quelques caractères et se lit d'un coup d'oeil dans un fichier de
base volé ; un document est un fichier du disque, servi derrière autorisation et portant un nom
non devinable. Chiffrer les documents demanderait de garder la clé à côté d'eux pour les servir,
ce qui ne protégerait de rien, et empêcherait l'export en archive que la maquette demande.
La clé vit dans `MDF_CLE_COFFRE`, **hors du répertoire de données** : une sauvegarde de la base
seule ne rend aucun code, et il faut donc en garder une copie ailleurs.

---

## Tranche 4 : la famille (**livrée**)

- décisions et scrutins selon la structure, voix pondérées par les parts figées à l'ouverture ;
- seuils lus dans `regle_decision`, jamais codés en dur ;
- carte « aucun vote » et convocation d'assemblée pour la SCI, décision sans vote en nom propre ;
- historique des décisions avec majorité requise et résultat ;
- carte des rôles sur l'écran Membres (les personnes et les rôles sont livrés
  en tranche 1.5) ;
- accès temporaires : invités et locataires par lien limité dans le temps, révocable ;
- notifications `vote_ouvert` et `vote_cloture_proche`.

**Ce que vous vérifiez vous-même** : un lien d'invité expiré ne donne plus accès au code
d'accès, y compris en tapant l'adresse directement. La liste complète est dans
`docs/recette-t4.md`.

**Deux décisions prises en chemin.**

Le seuil de majorité porte sur le **corps électoral entier**, pas sur les voix exprimées : une
abstention pèse donc comme un refus. C'est la lecture de l'article 815-3 du Code civil, qui parle
de la majorité des deux tiers des droits indivis et non des droits exprimés. Le rappel envoyé
trois jours avant la clôture le dit à ceux qui n'ont pas répondu, parce que quelqu'un qui
l'ignore croit s'abstenir alors qu'il bloque.

Un accès temporaire crée une **vraie personne** sans mot de passe, plutôt qu'un second mécanisme
d'authentification. Toute l'application continue alors de fonctionner sans savoir que ce visiteur
est arrivé par un lien : portées, journal des codes, notifications. Le prix est un drapeau,
`acces_lien_seul`, qui empêche ce compte de devenir permanent par « mot de passe oublié ».

---

## Tranche 5 : location saisonnière et souvenirs (**livrée**)

- module activable **par bien**, invisible ailleurs, et qui refuse au lieu de rendre vide ;
- réservations locatives (qui bloquent le calendrier comme n'importe quel séjour), loyers
  encaissés, charges déduites, net à répartir ;
- alerte quand une semaine est ouverte à la location sur une année où la famille n'a encore
  rien posé, sans rien bloquer ;
- accès locataire par lien limité, sans création de compte (le mécanisme vient de la tranche 4) ;
- albums photo par bien, album créé tout seul à la fin d'un séjour, vignettes engendrées côté
  serveur, livre d'or par année.

**Ce que vous vérifiez vous-même** : le module location n'existe nulle part sur le bien de
montagne, et une photo déposée sur un bien n'apparaît pas dans l'album de l'autre.
La liste complète est dans `docs/recette-t5.md`.

**Deux décisions prises en chemin.**

Les vignettes sont fabriquées avec `jpeg-js` et `pngjs`, **purement JavaScript** et sans aucune
dépendance transitive, et non avec `sharp`. `sharp` est plus rapide d'un ordre de grandeur, et
c'est trente méga-octets de binaires natifs qui échouent d'une façon désagréable à comprendre
dans un conteneur LXC minimal. Une vignette se fabrique une fois, au dépôt, jamais à
l'affichage : la lenteur ne coûte rien, la dépendance aurait coûté une soirée un jour de panne.
WEBP et GIF n'ont pas de vignette, faute de décodeur léger, et sont servis tels quels.

Le net locatif ne se répartit pas d'un bouton sur cet écran : il se verse depuis l'écran
Dépenses, qui a déjà les règles datées, les arrondis et l'historique. Un second chemin de
répartition, c'est un second arrondi, donc deux tables qui ne tombent pas sur le même centime et
deux personnes qui ne sont pas d'accord.

**Quatre défauts antérieurs, corrigés au passage.** Un écran plein d'images a révélé que les
images ne s'affichaient nulle part : la balise `img` demandait le fichier sans jeton et recevait
un refus. Dans la foulée : un document du coffre n'était téléchargeable par personne, faute de
rattachement dans la route des fichiers ; un acte notarié scanné ne se déposait pas, parce que le
fichier voyageait encodé en base64 dans du JSON, ce qui le gonfle d'un tiers ; et un locataire
arrivé par lien ouvrait un coffre vide, alors que le code de la boîte à clés est ce que ce lien
promet. Les quatre sont couverts par `backend/test/fichiers-acces.test.ts`.

---

## Stratégie de migration

**Le principe** : le schéma évolue par migrations numérotées, appliquées au démarrage, dans une
transaction, enregistrées dans `schema_migration`. Pas de migration descendante : la marche
arrière est une restauration de sauvegarde, documentée et testée. C'est plus honnête qu'un `down`
que personne n'exécute jamais et qui ne marche pas le jour où on en a besoin.

```
backend/src/noyau/migrations/
  001-socle.ts        personnes, foyers, structures, biens, détentions, séjours,
                      saisons, fichiers, paramètres, notifications, journal, imports
  002-totp.ts         second facteur et codes de secours
  003-argent.ts       catégories, règles datées, dépenses, ventilations, règlements
  004-maison.ts       tâches, récurrences, contacts, documents, codes
  ...
```

Chaque migration est un objet `{ version, libelle, up(db) }`. Au démarrage :

1. lecture de `schema_migration` ;
2. si la base porte une version **inconnue du code**, le service refuse de démarrer avec un
   message explicite (« base en version 7, ce binaire connaît jusqu'à 5, vous avez déployé une
   version antérieure ») plutôt que de corrompre les données ;
3. les migrations manquantes sont appliquées en transaction, une par une, journalisées avec leur
   durée ;
4. échec d'une migration : transaction annulée, service arrêté, message en clair. Jamais un
   démarrage à moitié migré.

**Une sauvegarde automatique est prise avant toute migration** (`VACUUM INTO` dans
`MDF_DATA_DIR/sauvegardes/avant-migration-<version>-<horodatage>.db`), avec rotation. C'est ce
qui rend la marche arrière réelle, pas théorique.

**Un test de CI** applique toutes les migrations depuis une base vide et compare le schéma
obtenu à `docs/schema.sql`, versionné. Une migration oubliée ou une divergence entre la base
d'un développement et celle d'une installation existante échoue en CI, pas en production.

---

## Tests, et ce qu'ils couvrent

Ils sont écrits avec le code, pas après, et bloquent la CI. Priorité aux cinq sujets du brief :

| Sujet | Ce qui est vérifié |
| --- | --- |
| Répartition avec quotes-parts historisées | Une dépense au 12 mars utilise les parts du 12 mars, pas celles d'aujourd'hui. Un changement rétroactif ne modifie aucune ventilation existante. La somme des parts égale toujours le montant total, au centime. |
| Chevauchement de séjours | Rotation le même jour acceptée. Inclusion, chevauchement partiel des deux côtés, séjour d'un jour, séjour à cheval sur deux mois et sur le changement d'année. Dépassement de capacité. |
| Seuils de majorité | 2/3 en indivision, unanimité pour un acte de disposition, quorum de SCI, aucun vote en nom propre. Cas limites : exactement le seuil, une abstention, un détenteur sorti pendant le scrutin. |
| Portée des documents et des codes | Chaque route, avec un étranger au bien : refusée. Un code de portée `sejour` la veille, pendant, le lendemain, et après. Un lien invité expiré, révoqué, ou pointant sur un autre bien. |
| Minimisation des virements | Le nombre de virements produit est minimal sur des cas construits. La somme des virements ramène tous les soldes à zéro, au centime. Cas dégénéré : tout le monde à zéro, une seule personne créditrice, montants qui ne tombent pas rond. |

S'y ajoutent : les migrations depuis une base vide, l'aller-retour export puis restauration, le
registre de paramètres (déclaré non lu, lu non déclaré), les tuiles, l'import Excel sur des
fichiers de test, et la temporisation de connexion.
