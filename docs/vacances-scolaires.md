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

L'application **ne va pas les chercher en ligne** : le brief interdit tout appel
réseau sortant, et cette règle ne se contourne pas pour un confort d'affichage.
La table vit donc dans le dépôt :

```
backend/src/calendrier/vacances.ts
```

### Ajouter une année

Une entrée par période, dans `CALENDRIER`. Les bornes suivent l'usage des
familles : **tous les jours où les enfants ne sont pas en classe**, du premier au
dernier inclus. L'arrêté dit « après la classe » et « au matin de la reprise »,
ce qui désigne les mêmes journées.

```ts
'2026-2027': [
  { nom: 'Toussaint', zone: null, debut: '2026-10-17', fin: '2026-11-01' },
  { nom: 'Hiver', zone: 'A', debut: '2027-02-06', fin: '2027-02-21' },
  ...
],
```

`zone: null` vaut pour les trois zones : c'est le cas de la Toussaint, de Noël
et de l'été, qui ne sont pas décalés.

Source à recopier, et à vérifier à chaque mise à jour :
<https://www.education.gouv.fr/le-calendrier-scolaire>

Les tests refusent une table incohérente : une date mal formée, une fin avant le
début, une période rangée dans la mauvaise année scolaire, ou une période
décalée qui n'existerait que pour deux zones sur trois.

### Quand une année manque

L'application **le dit**, en haut du calendrier. Elle n'invente pas par rotation
des zones, et elle n'affiche pas un mois vide qu'on prendrait pour « pas de
vacances ». Les jours fériés, eux, restent affichés : ils se calculent.

## Ce que ça donne à l'écran

Trois bandeaux fins sous chaque case, un par zone, à position fixe : une même
zone reste sur la même ligne d'une case à l'autre et se lit en diagonale sur
toute une semaine. Le décalage d'une semaine entre A, B et C dessine un escalier.

Les couleurs des zones ne peuvent pas être prises dans la palette des natures de
séjour : la case porte déjà un fond qui dit qui occupe la maison, et deux
informations ne se partagent pas le même canal visuel.

Un jour férié se marque sur le **numéro** du jour, en gras avec un point, pour la
même raison. Le survol d'une case nomme le férié et les zones concernées.
