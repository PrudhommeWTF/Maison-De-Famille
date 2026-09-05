# Recette de la tranche 4

Ce que vous vérifiez vous-même, par l'usage.

**En une phrase : un lien d'invité expiré ne donne plus accès au code d'accès,
y compris en tapant l'adresse directement.**

---

## 1. Un vote, du début à la fin

- [ ] Vous ouvrez un vote « Remplacement de la chaudière », acte de gestion
      courante, clôture dans quinze jours
- [ ] La règle affichée est celle de la table (« Deux tiers pour la gestion
      courante »), pas une valeur écrite dans le code
- [ ] Chaque indivisaire reçoit un courriel qui porte **la question et la
      majorité requise** : deux tiers et unanimité n'appellent pas la même
      attention, et on ne va pas ouvrir l'application pour le découvrir
- [ ] Le seuil s'affiche en voix (« 67 sur 100 »), pas seulement en pourcentage
- [ ] Vous votez : la phrase sous les boutons dit ce que pèse votre voix et ce
      qu'il manque encore
- [ ] Vous changez votre vote : c'est accepté tant que le scrutin est ouvert
- [ ] Vous dépouillez : le résultat s'inscrit à l'historique avec sa majorité
      requise, et le détail s'ouvre en un clic

## 2. Le point qui surprendra la famille

**Une abstention compte comme un refus.** Ce n'est pas un choix d'ergonomie,
c'est la lecture de l'article 815-3 du Code civil, qui parle de « la majorité
des deux tiers **des droits indivis** », et non des droits exprimés.

- [ ] Deux indivisaires sur quatre votent pour, deux ne répondent pas : le vote
      est rejeté, alors que les voix exprimées étaient unanimes
- [ ] Le détail du dépouillement l'explique en toutes lettres, sans qu'on ait à
      demander pourquoi
- [ ] Trois jours avant la clôture, **seuls ceux qui n'ont pas voté** reçoivent
      un rappel, et ce rappel dit que ne pas répondre revient à voter contre

Si votre convention d'indivision prévoit autre chose, la règle se modifie dans
la table `regle_decision` : aucun seuil n'est écrit dans le code.

## 3. Les cas limites, qui sont ceux qu'on contestera

- [ ] Un vote qui atteint le seuil **exactement** passe (deux tiers de 300 parts
      valent 200, et 200 suffisent)
- [ ] Une part de moins ne passe pas
- [ ] Sur 100 parts, il faut 67 voix et non 66 : l'arrondi se fait au supérieur
- [ ] Pour un acte de disposition, une seule abstention suffit à bloquer :
      vendre une maison de famille demande que tout le monde le dise, pas que
      personne ne s'y oppose

## 4. Le détenteur qui sort pendant le scrutin

C'est le cas que le brief désigne nommément, et le plus délicat.

- [ ] Vous ouvrez un vote, puis vous modifiez la répartition des parts : le
      corps électoral **ne bouge pas**, il est figé à l'ouverture
- [ ] Celui qui a cédé ses parts garde sa voix et son poids, et **peut encore
      voter** : le convoquer puis lui fermer la porte n'aurait aucun sens
- [ ] Celui qui est entré après l'ouverture ne vote pas sur ce scrutin, et le
      message le lui dit, en précisant que ses parts compteront au prochain
- [ ] Un scrutin dépouillé se relit tel qu'il a été pris : le résultat est
      enregistré, pas recalculé. Modifiez la règle après coup, la décision
      passée ne change pas.

## 5. En SCI et en nom propre

- [ ] Sur un bien en nom propre, l'écran dit « Aucun vote sur ce bien » et
      n'offre aucun bouton d'ouverture
- [ ] En SCI, la règle applicable est celle des statuts, avec son quorum : sous
      le quorum, le scrutin est sans effet même si tous les votants sont pour
- [ ] Une date de convocation d'assemblée peut être portée au scrutin

## 6. L'accès temporaire, et la règle qui compte

- [ ] Depuis « Personnes et rôles », vous ouvrez un accès pour « Famille Berger,
      locataires », valable jusqu'à la fin de leur séjour
- [ ] Le lien s'affiche **une seule fois**, et l'écran vous prévient de ce qu'il
      vaut
- [ ] Le locataire clique : il entre **sans compte et sans mot de passe**
- [ ] Il voit le calendrier, la fiche du bien et le coffre-fort ; il ne voit ni
      les dépenses, ni les soldes, ni les personnes, ni les décisions, ni le
      carnet d'entretien
- [ ] Pendant son séjour, il voit le code de la boîte à clés (portée « pendant
      le séjour »), et cet affichage apparaît au journal du code

**Le test qui compte :**

- [ ] Le lendemain de la fin de son séjour, le code n'est plus visible
- [ ] Passé la date de fin de l'accès, **son onglet resté ouvert ne montre plus
      rien du bien**, et son lien ne rouvre plus de session
- [ ] Vous révoquez un accès : il est coupé **immédiatement**, la session en
      cours comprise, et le porteur retombe sur l'écran de connexion

Deux verrous indépendants tiennent cette règle, et il faut les deux : le jeton
du lien, qui n'ouvre plus de session, et la date de fin du rôle, qui coupe les
sessions déjà ouvertes. Le second est celui qui compte, parce que l'onglet du
locataire est resté ouvert.

## 7. Ce qu'un lien ne permet pas de devenir

- [ ] Un locataire dont vous avez renseigné l'adresse de courriel tente
      « mot de passe oublié » : rien ne part. La réponse reste identique à
      toutes les autres, sans révéler que ce compte existe.
- [ ] Un accès temporaire ne peut pas dépasser un an : au-delà, l'application
      renvoie vers la création d'un vrai compte

---

## Retrouver ce qui s'est passé

```bash
sqlite3 /var/lib/maison-de-famille/maison.db \
  "SELECT a.cree_le, a.libelle, a.expire_le, a.revoque_le, a.utilisations, p.nom AS ouvert_par
     FROM acces_temporaire a LEFT JOIN personne p ON p.id = a.cree_par
    ORDER BY a.cree_le DESC;"
```

```bash
journalctl -u maison-de-famille | grep -E "Accès temporaire|Scrutin"
```
