# Recette de la tranche 5

Ce que vous vérifiez vous-même, par l'usage.

**En une phrase : le module location n'existe nulle part sur le bien de
montagne, et une photo déposée sur un bien n'apparaît pas dans l'album de
l'autre.**

---

## 1. « Activable par bien » se prend au mot

- [ ] Sur un bien neuf, aucune entrée « Location saisonnière » dans le menu
- [ ] Vous ouvrez la fiche du bien, « Modifier la fiche », vous passez
      « Location saisonnière » à **Activée** et vous enregistrez
- [ ] L'entrée apparaît dans le menu, et seulement sur ce bien
- [ ] Sur l'autre bien, l'entrée n'est **toujours pas là**
- [ ] En tapant l'adresse `/bien/location` sur le bien de montagne, l'écran ne
      montre pas un tableau vide : il dit que le module n'est pas activé et où
      l'activer

Un écran qui répondrait « aucune réservation » sur un bien qu'on ne loue pas
laisserait croire qu'il n'y en a pas encore, ce qui est faux et différent.

## 2. Une réservation est un séjour

- [ ] Vous ajoutez une réservation : locataire, dates, occupants, loyer,
      acompte reçu
- [ ] La semaine apparaît **au calendrier**, au même titre qu'un séjour de
      famille, et avec sa propre couleur
- [ ] Une demande de séjour de famille sur ces dates est signalée en conflit,
      sans qu'on ait rien branché de particulier
- [ ] Un nombre d'occupants supérieur aux couchages est refusé, et le message
      dit quoi faire
- [ ] Vous passez la réservation à « Annulée » : la semaine est **rendue** à la
      famille au calendrier

## 3. Ce qui compte, c'est ce qui est encaissé

- [ ] Une réservation « à confirmer » ne rapporte rien
- [ ] Une réservation avec acompte rapporte **l'acompte**, pas le loyer
- [ ] Vous la passez à « Soldé » : l'encaissé devient le loyer entier
- [ ] Le bandeau montre loyers encaissés, nuits louées, charges déduites et net
      à répartir
- [ ] Le texte sous le tableau explique le calcul ligne à ligne, y compris ce
      qui reste à percevoir et qui n'est **pas** compté

Compter les loyers signés plutôt que les loyers reçus donnerait un net qu'on ne
pourrait pas verser, et une famille qui se partage de l'argent qui n'est pas là
se fâche vite.

## 4. L'alerte de saison

- [ ] Vous ouvrez une semaine à la location sur une année où aucun séjour de
      famille n'est posé : un encart le signale
- [ ] Il ne bloque rien : vous pouvez enregistrer quand même
- [ ] Vous posez un séjour de famille sur la même année : l'encart disparaît

C'est un arbitrage de gérante, pas celui de l'application. Mais elle doit le
voir avant, pas le découvrir quand son frère appelle.

## 5. Les albums, et leur étanchéité

- [ ] Vous créez un album sur le bien de mer et vous y déposez deux photos
- [ ] Les vignettes s'affichent **vraiment** : pas de cadre gris, pas d'icône
      d'image cassée
- [ ] Ce sont les vignettes qui sont servies, pas les originales : l'album
      s'ouvre vite, même en 4G au fond d'une vallée
- [ ] Vous basculez sur le bien de montagne, écran Souvenirs : l'album de la
      mer n'y est pas, et son titre non plus
- [ ] Un album se crée **tout seul** à la fin d'un séjour de famille
- [ ] Un membre de foyer peut déposer une photo
- [ ] Il peut retirer **la sienne**, pas celle d'un autre : le message nomme
      l'auteur et dit qui peut la retirer
- [ ] Une gérante peut retirer n'importe laquelle

## 6. Le livre d'or

- [ ] Vous laissez un mot signé : il apparaît en tête, daté
- [ ] Le livre d'or du bien de montagne reste vierge

## 7. Ce qu'un locataire voit, et ne voit pas

- [ ] Depuis « Décisions et votes », vous ouvrez un accès temporaire rattaché à
      la semaine du locataire, et vous lui envoyez le lien
- [ ] Il ouvre une session sans compte, voit ses dates et **le code de la boîte
      à clés**
- [ ] Il ne voit ni les dépenses, ni les personnes, ni l'entretien, ni les
      souvenirs de la famille
- [ ] Le lendemain de son départ, le code ne s'affiche plus, y compris en
      tapant l'adresse

## Ce que cette tranche a corrigé, trouvé en la préparant

Quatre défauts réels, tous antérieurs à la tranche 5, et tous invisibles tant
qu'on n'avait pas d'écran plein d'images pour les révéler.

1. **Aucune image ne s'affichait.** La photo de couverture d'un bien et les
   pièces jointes du coffre passaient par une adresse nue : le navigateur
   demandait le fichier tout seul, sans jeton, et recevait un refus. Les
   images passent maintenant par le service de fichiers, qui porte le jeton.
2. **Un document du coffre n'était téléchargeable par personne**, pas même par
   la gérante qui venait de le déposer : la route des fichiers ne connaissait
   aucun rattachement vers le coffre, et son défaut est le refus. Les
   rattachements du coffre et des albums existent maintenant, avec la portée du
   document comme condition.
3. **Un acte notarié scanné ne se déposait pas.** Le fichier voyageait encodé
   en base64 dans du JSON, ce qui le gonfle d'un tiers et le faisait dépasser
   la charge maximale dès sept cents kilo-octets. Le corps de la requête est
   maintenant le fichier lui-même, et seule la limite réglée dans Paramètres
   décide.
4. **Un locataire arrivé par lien ouvrait un coffre vide.** Le code de la boîte
   à clés est exactement ce que ce lien promet ; il n'était pas rattaché à son
   séjour, parce que le séjour est posé par la gérante et non par lui.

Ces quatre points sont couverts par `backend/test/fichiers-acces.test.ts` et par
un test de la recette de la tranche 4.

## Ce qui reste à faire, et que je signale franchement

- **Votre export Excel n'a jamais été passé dans l'importeur.** C'est le point
  le plus important de cette liste, et il est là depuis la tranche 1.
- **La répartition du net locatif ne se déclenche pas d'un bouton.** Le net est
  calculé et affiché ; pour le répartir, on saisit le versement comme une
  dépense négative sur l'écran Dépenses, qui a déjà les règles datées, les
  arrondis et l'historique. Ajouter un second chemin de répartition, c'est un
  second arrondi et deux tables qui ne tombent pas sur le même centime.
- **Aucun envoi de courriel au locataire.** Le lien d'accès se copie et
  s'envoie à la main. La mise en file existe, mais le message type reste à
  écrire.
