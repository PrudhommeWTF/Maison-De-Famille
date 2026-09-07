# Vacances scolaires et jours fériés

Le calendrier d'occupation fait ressortir les vacances scolaires des trois zones
et les jours fériés français. Deux mécanismes très différents, et il faut savoir
lequel demande de l'entretien.

## Les jours fériés : rien à faire

Ils se **calculent**. Sept sont à date fixe, quatre se déduisent de Pâques, dont
la date suit l'algorithme de Meeus. Le calcul est juste pour toujours, y compris
en 2043 quand plus personne ne touchera à cette application. Vérifié contre
dix-neuf dates de Pâques connues et les deux bornes extrêmes possibles
(22 mars et 25 avril).

Le réglage **Jours fériés d'Alsace-Moselle** ajoute le Vendredi saint et le
26 décembre. À laisser éteint ailleurs : afficher deux fériés qui n'en sont pas
ferait rater un jour de travail.

## Les vacances scolaires : une table à tenir à jour

Elles ne se déduisent de rien. Elles sont fixées par arrêté ministériel, et
l'ordre des zones tourne d'une année sur l'autre. Aucune formule ne les donne.

L'application **va les chercher elle-même** sur le portail de l'Éducation
nationale quand une année attendue manque, et sinon ne sort pas. Le dépôt d'un
fichier reste possible et reste nécessaire sur un serveur sans accès à Internet :
voir [Le rafraîchissement automatique](#le-rafraîchissement-automatique) plus bas.

La table vit en base, dans `vacance_scolaire`, et se met à jour depuis l'écran
**Administration**, section « Vacances scolaires ». Toucher au code n'est plus
nécessaire. L'installation part avec l'année 2025-2026 déjà renseignée.

### Mettre à jour, une fois par an

1. Télécharger le calendrier scolaire sur
   <https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/export/>,
   au format CSV. Le fichier couvre plusieurs années d'un coup.
2. Ouvrir **Administration**, section « Vacances scolaires », puis « Déposer un
   calendrier ».
3. Relire l'aperçu, et seulement alors enregistrer.

Rien n'est écrit avant ce dernier clic. L'aperçu dit combien de lignes ont été
lues, combien de périodes ont été retenues, quelles années seront ajoutées ou
remplacées, et quelles lignes ont été écartées avec leur raison.

Un import **remplace les années qu'il apporte** et ne touche à aucune autre :
déposer un fichier 2027-2028 ne fait rien perdre de 2026-2027.

### Le rafraîchissement automatique

Le service va chercher le fichier officiel **tout seul**, au démarrage puis
toutes les six heures, et seulement si une année attendue manque. Les années
attendues sont celle en cours et la suivante : une famille arrête les dates de
son été en janvier.

**C'est la seule écriture de l'application que personne ne demande, et elle est
bornée :**

- elle n'ajoute que les années **absentes** de la base ;
- elle ne réécrit **jamais** une année déjà enregistrée, même si le portail la
  publie autrement. Ce qu'un gérant a relu et validé reste tel quel ;
- l'origine est écrite en clair dans la table de l'écran, sans nom de personne :
  on voit d'un coup d'oeil ce qui est arrivé tout seul.

Si rien n'arrive, c'est que le portail ne publie pas encore l'année demandée, ou
que ce serveur ne sort pas sur Internet. Le journal le dit une fois, pas quatre
fois par jour, et l'écran continue d'annoncer l'année manquante. Le dépôt manuel
reste toujours possible.

### Récupérer maintenant

Le bouton **Récupérer maintenant**, à côté de « Déposer un calendrier », fait ce
que le rafraîchissement automatique ne fera jamais : rapporter une année **déjà
en base** pour la remplacer, par exemple quand un arrêté modifie des dates
publiées. Il remplit le même aperçu qu'un dépôt de fichier, et **rien n'est
enregistré sans confirmation.**

Les garde-fous valent pour les deux chemins :

- l'adresse est **en dur dans le code**, aucun réglage ne permet de la changer ;
- l'hôte est **revérifié après les redirections** ;
- la réponse est plafonnée à 8 Mo et abandonnée au bout de 20 secondes ;
- l'instance **signale son existence** au portail à chaque récupération, et rien
  d'autre : aucune donnée de la famille ne part.

Le navigateur, lui, ne parle jamais au portail : c'est le serveur qui va
chercher le fichier, et la politique de sécurité de contenu reste fermée.

### Ce qui est écarté, et pourquoi

Le fichier officiel contient plus que des vacances. Sont écartés, chacun avec sa
raison affichée :

- les lignes de **rentrée** et de **prérentrée** : ce sont des jours de classe,
  les importer ferait poser un séjour sur une reprise ;
- les lignes marquées **Enseignants** : la prérentrée des professeurs n'est pas
  une vacance pour les enfants ;
- les **zones hors métropole** (Corse, outre-mer) : le calendrier n'affiche que
  les zones A, B et C.

### La borne de fin

C'est le seul point où deux fichiers honnêtes peuvent vouloir dire deux choses.
Le fichier officiel donne le **jour de la reprise des cours** ; un tableau tenu à
la main donne plutôt le **dernier jour de vacances**.

Les deux se distinguent sans rien supposer : une reprise tombe toujours un jour
de classe, donc jamais un samedi ni un dimanche. La convention retenue est
décidée pour le fichier entier et **annoncée dans l'aperçu**, avec les dates
telles qu'elles seront enregistrées. Si la phrase ne correspond pas à votre
fichier, n'enregistrez pas.

### Un tableau tenu à la main

Si vous préférez saisir les dates vous-même, un tableau à cinq colonnes suffit,
en CSV ou en tableur :

```
Période;Zone;Début;Fin;Année scolaire
Toussaint;A;17/10/2026;01/11/2026;2026-2027
Toussaint;B;17/10/2026;01/11/2026;2026-2027
Toussaint;C;17/10/2026;01/11/2026;2026-2027
```

Une période commune aux trois zones s'écrit en trois lignes. Le calendrier les
regroupe tout seul à l'affichage : l'infobulle du 25 décembre dit « Noël » une
fois, pas trois.

Source à vérifier à chaque mise à jour :
<https://www.education.gouv.fr/le-calendrier-scolaire>

### Quand une année manque

L'application **le dit**, en haut du calendrier, et propose au gérant d'aller
déposer le fichier. Elle n'invente pas par rotation des zones, et elle n'affiche
pas un mois vide qu'on prendrait pour « pas de vacances ». Les jours fériés, eux,
restent affichés : ils se calculent.

## Ce que ça donne à l'écran

Trois bandeaux fins sous chaque case, un par zone, à position fixe : une même
zone reste sur la même ligne d'une case à l'autre et se lit en diagonale sur
toute une semaine. Le décalage d'une semaine entre A, B et C dessine un escalier.

Les couleurs des zones ne peuvent pas être prises dans la palette des natures de
séjour : la case porte déjà un fond qui dit qui occupe la maison, et deux
informations ne se partagent pas le même canal visuel.

Un jour férié se marque sur le **numéro** du jour, en gras avec un point, pour la
même raison. Le survol d'une case nomme le férié et les zones concernées.
