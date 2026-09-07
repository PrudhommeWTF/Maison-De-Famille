# Architecture

Ce document explique **comment l'application est découpée et pourquoi**. Le schéma des données
est dans `modele-de-donnees.md`, le plan de livraison dans `plan-des-tranches.md`.

## Pile technique

Identique à Foyer-App, sur décision explicite : Angular 21 en composants standalone avec signals,
backend Node/Express en TypeScript, SQLite via `better-sqlite3`, une seule image Docker ou une
installation LXC native sous systemd, authentification JWT. Aucun service supplémentaire, aucune
base externe.

Je n'ai trouvé aucun point qui rende ce choix intenable. Le volume de données est minuscule
(quelques milliers de lignes sur dix ans), les écritures sont rares et jamais concurrentes au
sens d'une charge, et SQLite en mode WAL avec des transactions courtes tient cela sans effort.
Le seul point qui aurait pu poser question, la génération de vignettes de photos, se règle sans
dépendance native lourde (voir « Photos » plus bas).

### Ce que nous ne refaisons pas comme Foyer-App

Foyer-App stocke tout l'état du foyer dans **un document JSON** relu et réécrit en entier à
chaque modification. Ici, relationnel dès la première ligne :

- une table par entité, des clés étrangères, des index ;
- des migrations **numérotées** appliquées au démarrage, jamais des `ALTER TABLE` dans un
  `try/catch` ;
- des requêtes préparées, jamais de concaténation de SQL ;
- des mutations granulaires : on écrit la ligne qui change, pas l'état du monde. Deux personnes
  qui saisissent une dépense en même temps ne s'écrasent pas, parce qu'elles n'écrivent pas au
  même endroit.

## Découpage en modules

Chaque module est autonome : il porte son schéma, ses règles, ses routes, sa tuile de tableau de
bord et ses paramètres. Le noyau ne connaît aucun module, les modules ne se connaissent pas
entre eux (ils passent par le noyau).

```
backend/src/
  noyau/
    db.ts              ouverture SQLite, pragmas, exécution des migrations
    migrations/        001-socle.ts, 002-..., appliquées en transaction au démarrage
    log.ts             journalisation à trois niveaux, niveau réglable sans redémarrage
    erreurs.ts         erreurs typées, message français explicite, code stable
    http.ts            gardes, validation d'entrée, enveloppe de réponse
  auth/                mots de passe (argon2), JWT, temporisation, TOTP, liens invités
  acces/               LE MODULE CENTRAL : résolution de portée, matrice des rôles, gardes
  patrimoine/          structures, règles de décision, biens, fiche, détentions historisées, foyers
  sejours/             calendrier, demandes, conflits, saisons, voeux, quotas, import Excel
  argent/              catégories, règles datées, dépenses, ventilation gelée, soldes, virements, appels de fonds
  maison/              tâches, récurrences, checklist de départ, inventaire
  coffre/              documents versionnés, codes chiffrés, journal de lecture
  decisions/           scrutins, poids figés, dépouillement, historique
  location/            réservations, encaissements, net à répartir
  souvenirs/           albums, photos, vignettes
  stockage/            service de fichiers partagé (empreintes, disque, autorisation)
  parametres/          registre déclaratif + stockage + routes
  notifications/       file durable, gabarits de courriel, ordonnanceur, préférences
  export/              CSV séjours, CSV dépenses, export complet de l'instance
  systeme/             santé, état, sauvegarde, diagnostic
```

Chaque module a la même forme :

| Fichier | Rôle | Testé ? |
| --- | --- | --- |
| `schema.ts` | ses migrations | oui, par la comparaison de schéma |
| `regles.ts` | **logique pure**, sans base ni HTTP | oui, c'est là que sont les tests qui comptent |
| `repo.ts` | requêtes préparées et transactions | oui, sur base en mémoire |
| `routes.ts` | Express, validation, autorisation, appel du repo | oui, tests de portée |
| `tuile.ts` | résumé pour le tableau de bord (côté frontend) | oui |

**Pourquoi `regles.ts` séparé.** Le calcul d'une répartition avec des quotes-parts historisées,
la détection de chevauchement, le seuil de majorité et la minimisation des virements sont des
fonctions pures : des données entrent, un résultat sort. Elles se testent sans serveur, sans
base et sans navigateur, donc elles sont testées sérieusement. Une règle métier qui vit dans une
route Express ne se teste jamais vraiment.

## Le module `acces` : la règle la plus importante

> Un détenteur d'un bien ne doit rien voir d'un autre bien auquel il n'est pas rattaché.

Cette règle n'est pas répartie dans les routes, où elle finirait par être oubliée à un endroit.
Elle est **centralisée** :

1. Un intergiciel résout, à chaque requête, la **portée** de l'appelant :

```ts
interface Portee {
  personneId: number | null;              // null pour un lien invité
  lienInviteId: number | null;
  biens: Map<number, Role>;               // uniquement les biens auxquels il est rattaché
  structures: Map<number, Role>;
  sejoursEnCours: number[];               // sert à la portée « sejour » des codes
}
```

2. **Aucune requête de module ne part sans les identifiants autorisés.** Les repos prennent la
   portée en paramètre et filtrent en SQL (`WHERE bien_id IN (...)`). Il n'y a pas de « on
   récupère tout puis on filtre à l'affichage » : le serveur ne lit jamais ce qu'il n'a pas le
   droit de rendre.

3. Un identifiant qui arrive dans l'URL n'est **jamais** cru. `GET /api/biens/7/depenses` avec un
   bien 7 hors portée répond 403 avec un message clair, sans avoir touché aux dépenses.

4. Un test de recette parcourt **toutes** les routes déclarées et vérifie qu'un utilisateur
   étranger au bien est refusé. Une route ajoutée sans garde fait échouer la CI, parce que le test
   énumère le routeur Express et exige que chaque route déclare sa portée.

### Découpage par rôle, proposition par défaut

Vous tranchez, je propose. `X` = accès, `S` = son propre périmètre seulement.

| | Gérant | Détenteur | Membre de foyer | Invité / locataire |
| --- | --- | --- | --- | --- |
| Calendrier du bien | X | X | X | dates de son séjour |
| Demander un séjour | X | X | X | non |
| Arbitrer une demande | X | non | non | non |
| Saisir un séjour pour un autre | X | non | non | non |
| Dépenses, liste et détail | X | X | non | non |
| Son solde | X | X | S, à l'échelle du foyer | non |
| Soldes des autres foyers | X | X | non | non |
| Justificatifs | X | X | non | non |
| Fiche du bien, guide d'arrivée | X | X | X | X pendant son séjour |
| Inventaire, signaler une casse | X | X | X | non |
| Carnet d'entretien | X | X | lecture | non |
| Documents portée `detenteurs` (notaire, statuts) | X | X | non | non |
| Documents portée `membres` (guide, notice chaudière) | X | X | X | non |
| Codes portée `membres` | X | X | X | non |
| Codes portée `sejour` | X | X | pendant son séjour | pendant son séjour |
| Décisions et votes | X | X, voix pondérée | lecture du résultat | non |
| Membres et quotes-parts | X | X | noms seulement, sans les parts | non |
| Souvenirs | X | X | X | non |

**Le point à trancher** est la ligne « Membres et quotes-parts ». Ma recommandation est que le
conjoint d'un indivisaire voie qui compose l'indivision, mais pas la répartition chiffrée des
parts : c'est une information patrimoniale, et elle circulera de toute façon dans la famille par
d'autres canaux si elle doit circuler. Le second point est « Dépenses » : je propose que le membre
de foyer ne voie pas la liste des dépenses, seulement le solde consolidé de son foyer, pour éviter
qu'un conjoint découvre le montant de la taxe foncière avant l'indivisaire concerné. Ces deux
lignes sont un **paramètre déclaré** (`acces.membreFoyerVoitDepenses`,
`acces.membreFoyerVoitParts`), donc modifiables sans redéploiement une fois que vous aurez vu à
l'usage.

## Registre de paramètres déclaratif

Repris de Foyer-App, qui l'a déjà, et étendu. Chaque module déclare ses réglages **une seule
fois**, avec clé, type, valeur par défaut, portée, section et description en français. La page
de configuration est **engendrée** depuis ce registre : ajouter un réglage ne demande jamais de
toucher à un écran.

Nouveauté par rapport à Foyer-App : la portée d'un paramètre peut être `deploiement`,
`instance`, `structure`, `bien` ou `personnel`. C'est ce qui permet à la location saisonnière
d'être activée sur un bien et invisible sur l'autre, sans aucun `if` sur un identifiant de bien.

Trois tests bloquent la CI :

1. un paramètre déclaré que **personne ne lit** fait échouer ;
2. une clé lue qui n'est **pas déclarée** fait échouer ;
3. `docs/parametres.md`, engendré depuis le registre, doit être à jour.

Aucun code ne lit un réglage autrement que par `parametre('cle', portee)`.

## Contrat de tuile

Le tableau de bord **ne calcule rien**. Chaque module fournit un objet qui décrit son résumé et
ses actions rapides :

```ts
interface Tuile<T> {
  id: string;
  titre: string;
  ecran: string;                                   // où mène « Tout voir »
  portee: 'consolide' | 'bien';                    // visible en vue « Tous les biens » ?
  actif: (ctx: Contexte) => boolean;               // location : seulement si activée sur ce bien
  etat: (ctx: Contexte) => EtatTuile<T>;           // prête | vide (avec un message) | en panne
  actions: (ctx: Contexte) => ActionRapide[];
}
```

Le tableau de bord parcourt le registre, appelle `etat()` et rend. Il ne connaît l'intérieur
d'aucun module. Une tuile en panne s'affiche comme telle avec son message, elle ne fait pas
tomber la page : c'est ce qui évite l'écran blanc que vous ne sauriez pas déboguer.

Les trois cartes de la maquette (« Ce qui vous attend », « Trésorerie », « Prochains séjours »)
sont composées de contributions de tuiles, triées par date limite.

## Sécurité

La sécurité est dans la première tranche, pas après. Résumé des décisions, le détail est dans
`docs/securite.md` (écrit avec le code).

| Sujet | Décision |
| --- | --- |
| Mots de passe | **argon2id** (`m=64 Mio, t=3, p=1`), pas bcrypt. Foyer-App utilise bcrypt à coût 12, ce qui est correct ; argon2id résiste mieux au calcul sur carte graphique, et le paquet `argon2` est natif mais fourni en binaire précompilé. Repli documenté sur bcrypt si le binaire pose problème sur votre LXC. |
| JWT | Secret **obligatoire** au démarrage (`MDF_JWT_SECRET`, 32 caractères minimum). Aucune valeur par défaut dans le code : le service refuse de démarrer, avec un message qui dit quoi faire. Algorithme vérifié explicitement (`algorithms: ['HS256']`), jeton d'accès de 15 minutes, jeton de renouvellement de 30 jours révocable par `token_version`. |
| Autorisation | Serveur, sur chaque route, avec le bien et la structure comme portée. Voir le module `acces`. |
| Connexion | Double temporisation, par compte visé (stricte) et par adresse IP (généreuse), reprise de Foyer-App. Réponse et délai **identiques** que le compte existe ou non : aucune énumération possible. |
| Codes d'accès | AES-256-GCM au repos, clé `MDF_CODES_KEY` distincte du secret JWT. Chaque affichage journalisé (auteur, horodatage, adresse). |
| Fichiers | Servis derrière autorisation, identifiants de 32 hexadécimaux non devinables, jamais exposés par le serveur web. |
| Second facteur | TOTP disponible pour tous, **fortement recommandé pour le rôle gérant**. Voir l'avis détaillé plus bas. |
| Réseau sortant | Aucun, sauf le SMTP que vous configurez. Polices et icônes **embarquées dans le dépôt**, pas de CDN. |
| En-têtes | `helmet` avec une politique de sécurité de contenu stricte, possible justement parce qu'il n'y a aucun CDN. |

### Avis sur le second facteur pour le gérant

**Recommandation : oui, et dans la première tranche.**

Le risque sans second facteur est concret. Cette application expose sur Internet, dans un seul
endroit : l'adresse exacte de deux résidences secondaires, les codes du portail et de la boîte à
clés, et le calendrier qui dit exactement quand elles sont vides. C'est un dossier de
cambriolage complet. Le mot de passe d'un membre de la famille sera réutilisé ailleurs, c'est
une certitude statistique sur quinze personnes dont plusieurs se connectent trois fois par an.

**Le coût est faible parce que le code existe déjà.** Foyer-App a `backend/src/auth/totp.ts` et
ses tests. Le portage est de l'ordre de deux heures, pas d'une journée. Ce n'est pas un
argument pour l'imposer à tout le monde, c'en est un pour ne pas s'en priver sur le rôle qui
peut tout voir.

**La contrainte réelle est la récupération**, et c'est là qu'il faut être prudent avec une
utilisatrice de plus de soixante-dix ans :

1. dix codes de secours affichés une fois, à imprimer, générés à l'activation ;
2. un second compte gérant obligatoire (l'application refuse qu'il n'y en ait qu'un seul avec
   second facteur actif) ;
3. une commande d'administration en dernier recours, à lancer dans le conteneur :
   `mdf-admin totp-reset <courriel>`. C'est votre filet, et il ne dépend d'aucun écran.

**Ma proposition finale** : TOTP optionnel pour tous, proposé à la première connexion d'un
gérant, jamais imposé par le code. Un paramètre `securite.totpObligatoirePourGerant` permet de
le rendre obligatoire le jour où vous le décidez. Si vous préférez ne pas l'activer pour votre
mère, l'alternative honnête est de restreindre l'accès aux codes d'accès à un second compte
gérant qui, lui, l'a activé.

## Notifications par courriel

**Les trois options, honnêtement.**

1. **Relais SMTP authentifié** vers un service qui accepte de porter votre courrier (votre
   fournisseur de messagerie, ou un service d'envoi transactionnel). L'application se connecte,
   s'authentifie, envoie. La délivrabilité est celle du relais, donc bonne.
2. **Envoi direct depuis le LXC** (postfix en mode satellite sans relais). Techniquement
   trivial pour vous, et **inutilisable en pratique** : une IP résidentielle ou un préfixe
   d'hébergeur non réputé se fait classer en indésirable par Gmail et Outlook, silencieusement.
   Vos frères et soeurs ne verront simplement jamais les messages. À écarter.
3. **Pas de courriel, notification dans l'application seulement.** Cela contredit directement
   votre besoin : « certains ne se connecteront que quand on leur écrit ».

**Recommandation : option 1**, avec `nodemailer` comme unique dépendance ajoutée. Écrire le
protocole SMTP à la main (STARTTLS, AUTH, encodage MIME des accents) représente trois cents
lignes que vous ne pourrez pas déboguer à trois heures du matin, pour économiser une dépendance
sans transitives. Le compromis penche nettement.

**Ce qu'il faut côté serveur, à préparer de votre côté :**

```
MDF_SMTP_HOST=smtp.exemple.fr
MDF_SMTP_PORT=587                 # STARTTLS. 465 pour du TLS implicite.
MDF_SMTP_USER=maison@prudhomme.wtf
MDF_SMTP_PASS=...                 # mot de passe d'application dédié, pas le mot de passe principal
MDF_SMTP_FROM="Maison de Famille <maison@prudhomme.wtf>"
MDF_PUBLIC_URL=https://maison.exemple.fr   # obligatoire : les liens des courriels sont absolus
```

Sur le domaine expéditeur, prévoyez un enregistrement SPF qui autorise le relais, et DKIM si le
relais le propose. Sans cela, même l'option 1 finit en indésirable.

**Mécanisme.** Les notifications sont écrites dans une table avant d'être envoyées (`notification`),
puis un ordonnanceur les dépile toutes les minutes, avec recul exponentiel et cinq tentatives.
Une panne SMTP ne perd rien. L'écran d'état système affiche la file en souffrance et le message
d'erreur SMTP **exact**, pas un « échec d'envoi » inutile. Un bouton « Envoyer un courriel de
test » dans les paramètres remonte l'erreur brute du relais.

**Volume maîtrisé.** Six types seulement, chacun activable ou désactivable par personne :

| Type | Destinataire | Quand |
| --- | --- | --- |
| `demande_nouvelle` | gérante du bien | à la création d'une demande |
| `demande_decidee` | demandeur | à la validation ou au renvoi |
| `vote_ouvert` | détenteurs de la structure | à l'ouverture d'un scrutin |
| `vote_cloture_proche` | détenteurs n'ayant pas voté | 48 h avant la clôture |
| `appel_de_fonds` | personnes concernées | à l'émission |
| `checklist_depart` | occupant du séjour | la veille de la fin du séjour |

Aucune notification à la saisie d'une dépense, conformément au brief. Les messages sont courts,
en texte et en HTML, avec un lien direct vers l'écran concerné.

## Photos et vignettes

Les photos sont téléversées, stockées sur le disque, et une vignette est engendrée côté serveur.
Pour éviter `sharp` (binaire natif lourd, source d'ennuis à la compilation sur LXC), les
vignettes sont produites par un redimensionnement JPEG en TypeScript pur, sans dépendance
native. Compromis assumé : c'est plus lent (de l'ordre de 200 ms par photo, en tâche de fond au
téléversement) et la qualité est légèrement inférieure à `sharp`. Pour un album familial, c'est
sans conséquence, et cela évite une dépendance qui casse à chaque montée de version de Node.

Une taille maximale par fichier et un quota par bien sont des paramètres déclarés. Les
téléversements sont validés par **signature de fichier** (les octets d'en-tête), pas par
extension ni par le type déclaré par le navigateur.

## Import du planning Excel

`sejours/import/` lit le fichier, en trois étapes visibles à l'écran :

1. **Lecture et détection** : colonnes reconnues, aperçu des vingt premières lignes.
2. **Correspondance** : vous associez chaque colonne du fichier à un champ (bien, nom, arrivée,
   départ, nature, note). La correspondance est mémorisée pour le prochain import.
3. **Simulation puis import** : le rapport dit combien de lignes seront créées, combien sont des
   doublons de séjours déjà présents, et **quelles lignes sont refusées et pourquoi** (date
   illisible, départ avant arrivée, bien inconnu). Rien n'est écrit tant que vous n'avez pas vu
   ce rapport.

L'import est **rejouable** : la clé de déduplication est (bien, arrivée, départ, nom normalisé).
Relancer le même fichier ne crée pas de doublon. Chaque séjour importé porte son `import_run_id`,
ce qui permet d'annuler un import entier en une action si la correspondance était mauvaise.

**Il me faut votre export Excel** pour finir cette partie. En attendant, je code contre un format
attendu documenté et un jeu de fichiers de test représentatifs (dates françaises, cellules
fusionnées, une ligne par personne ou une ligne par semaine selon la mise en forme).

## Export et réversibilité

- **CSV séjours** et **CSV dépenses** à tout moment, avec le détail de la ventilation en
  colonnes, encodés en UTF-8 avec BOM pour qu'Excel les ouvre correctement du premier coup.
- **Export complet de l'instance** : une archive `tar.gz` contenant la base SQLite (copie
  cohérente par `VACUUM INTO`, pas une copie de fichier à chaud), tous les fichiers joints, et
  un manifeste avec la version du schéma. Restaurable sur une instance vierge par une seule
  commande, et c'est un test automatisé : export, restauration, comparaison.

## Accessibilité

Les jetons de la maquette respectent 4,5:1, à trois exceptions près. Le paquet en signale une
lui-même (le gris de tâche barrée `#a29889`, remplacé par `#8c8377`) ; les deux autres sont
apparues au calcul en reprenant la palette Bootstrap : sur l'olive `#7a8b5c` et l'ambre
`#a5813f`, **aucune** couleur de libellé n'atteignait 4,5:1 (le blanc donnait 3,64 et 3,56,
l'encre 4,37 et 4,48). L'olive prend donc la teinte de survol que le paquet nomme déjà
(`#68784c`, 4,72:1) et l'ambre est assombri de 14 % (`#8e6f36`, 4,62:1). Contraintes tenues :
taille de texte jamais sous 11 px, cibles tactiles de 44 px minimum sur mobile, navigation au
clavier sur tous les contrôles, libellés de formulaire associés, et messages d'erreur explicites
plutôt que des champs rouges muets. Une partie des utilisateurs a plus de soixante-dix ans : la
page de connexion et l'écran d'accueil sont conçus pour être compris sans exploration.

## Contradictions relevées entre le brief, la maquette et la sécurité

| Sujet | Conflit | Arbitrage |
| --- | --- | --- |
| Polices et icônes | La maquette charge Google Fonts et Bootstrap Icons depuis un CDN. « Aucun appel réseau sortant ». | Polices et icônes **embarquées dans le dépôt**. L'apparence est identique, la politique de sécurité de contenu devient stricte. |
| Courriel | « Aucun appel réseau sortant » contre « le canal par défaut doit être le courriel ». | Vous avez déjà tranché : le SMTP que vous configurez est la seule sortie autorisée. Rien d'autre ne sort, jamais. |
| Rôle global | Le modèle suggéré porte `Personne(role_app)` unique, les données de la maquette montrent deux gérants différents. | Le rôle est porté par le rattachement à une structure ou à un bien. L'écran ne change pas. |
| Table `Solde` | Le modèle suggéré la liste, en la marquant « dérivé ». | Pas de table. Le solde est calculé, donc toujours juste. |
| `Depense(bien_id \| 'both')` | Valeur magique qui casse au troisième bien. | Table de jonction avec un poids. Comportement affiché identique. |
| Coffre-fort | L'écran de la maquette montre tous les documents. | Le serveur filtre selon la portée et le rôle. L'écran rend ce qu'il reçoit, et n'affiche pas un document qu'il n'a pas. |
| Codes sur l'accueil mobile | La maquette place un bouton « Codes » sur la carte du séjour à venir. | Conservé, mais le bouton ne rend rien hors de la fenêtre de validité du séjour, et chaque affichage est journalisé. |
| Prototype | `support.js` et `image-slot.js` sont dans `docs/design/handoff/`. | Référence uniquement. Aucun de leurs octets n'entre dans le produit. |
| Surcharge des variables Bootstrap | Le prototype réécrit une trentaine de variables `--bs-*` de composants pour contourner un piège de spécificité, et son propre paquet dit de ne pas reproduire ce contournement. | Bootstrap est **compilé depuis ses sources Sass** avec la palette du projet : les variantes dérivées restent cohérentes, et rien n'est à contourner. |
| Accordéon des rôles | La maquette replie « Ce que chaque rôle peut faire » dans un `accordion`, seul composant qui réclame le JavaScript de Bootstrap. | Les quatre rôles sont affichés dépliés, en colonnes. On évite ainsi d'embarquer le JavaScript de Bootstrap pour un seul écran, et le texte se lit sans un clic de plus. |
| Navigation mobile | La maquette décrit trois écrans mobiles et une barre basse à trois entrées, ce qui laissait dix écrans sur quinze sans aucun chemin au doigt. | Quatre entrées, dont un **tiroir** (`offcanvas`) qui porte la navigation entière, la même liste qu'au bureau. Le tiroir est ouvert par un signal et non par les attributs `data-bs-*`, comme le paquet le recommande pour une pile à rendu déclaratif. |
