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

Par défaut, l'application **ne va pas les chercher en ligne** : c'est vous qui
téléchargez le fichier officiel, et vous qui le déposez. C'est le mode livré, et
c'est celui qui garde l'instance entièrement muette vis-à-vis d'Internet.

Un réglage permet de changer cela, en connaissance de cause : voir
[Récupérer en ligne](#récupérer-en-ligne-facultatif) plus bas.

La table vit en base, dans `vacance_scolaire`, et se met à jour depuis l'écran
**Réglages**, section « Vacances scolaires ». Toucher au code n'est plus
nécessaire. L'installation part avec l'année 2025-2026 déjà renseignée.

### Mettre à jour, une fois par an

1. Télécharger le calendrier scolaire sur
   <https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/export/>,
   au format CSV. Le fichier couvre plusieurs années d'un coup.
2. Ouvrir **Réglages**, section « Vacances scolaires », puis « Déposer un
   calendrier ».
3. Relire l'aperçu, et seulement alors enregistrer.

Rien n'est écrit avant ce dernier clic. L'aperçu dit combien de lignes ont été
lues, combien de périodes ont été retenues, quelles années seront ajoutées ou
remplacées, et quelles lignes ont été écartées avec leur raison.

Un import **remplace les années qu'il apporte** et ne touche à aucune autre :
déposer un fichier 2027-2028 ne fait rien perdre de 2026-2027.

### Récupérer en ligne, facultatif

Le réglage **« Télécharger le calendrier scolaire »**, dans Réglages, section
Général, ajoute un bouton **Récupérer en ligne** à côté de « Déposer un
calendrier ». Il évite d'aller chercher le fichier soi-même une fois par an.

Il est **éteint par défaut**, et il faut savoir ce qu'on allume :

- c'est le **seul appel réseau sortant** de l'application en dehors du relais de
  courriel, donc le conteneur doit avoir le droit de sortir sur Internet ;
- l'instance **signale son existence** au portail à chaque récupération ;
- si le portail change d'adresse ou de format, le bouton cesse de fonctionner, et
  il faudra revenir au dépôt manuel en attendant une mise à jour.

Ce que le réglage ne change pas :

- l'adresse est **en dur dans le code**, aucun réglage ne permet de la changer ;
- l'hôte est **revérifié après les redirections** ;
- la réponse est plafonnée à 8 Mo et abandonnée au bout de 20 secondes ;
- **rien n'est enregistré sans confirmation.** Le bouton remplit le même aperçu
  que le dépôt d'un fichier, et il faut toujours cliquer sur « Enregistrer ».

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
