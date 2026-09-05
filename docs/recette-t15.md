# Recette de la tranche 1.5

Ce que vous vérifiez vous-même, par l'usage.

Cette tranche existe parce que la tranche 1 avait livré la moitié serveur de la
gestion des personnes, sans l'écran qui va avec : une gérante fraîchement
installée restait seule, et ne pouvait inscrire personne. Le parcours
d'inscription ne fonctionnait d'ailleurs pas non plus, pour une raison décrite
plus bas.

**En une phrase : votre mère installe l'instance, inscrit la fratrie, chacun
choisit son mot de passe et se connecte.**

---

## 1. Le premier écran après l'installation

- [ ] Le tableau de bord affiche une carte **Pour démarrer** qui dit par où
      commencer, dans l'ordre : inscrire la famille, désigner un second gérant,
      saisir les quotes-parts, configurer le relais de courriel, importer le
      planning
- [ ] Chaque étape dit à quoi elle sert, pas seulement ce qu'elle est
- [ ] Le bouton « Y aller » mène au bon écran
- [ ] La carte perd une étape dès que vous l'avez faite, et disparaît
      entièrement quand tout est fait

## 2. Inscrire quelqu'un

- [ ] L'entrée **Personnes et rôles** existe dans le menu de gauche
- [ ] Vous créez quelqu'un avec son nom et son adresse de courriel
- [ ] La ligne affiche « Invitation en attente » tant qu'il ne s'est pas connecté,
      puis la date de sa dernière visite
- [ ] La personne reçoit un courriel signé de votre nom, choisit son mot de
      passe, et se connecte. **Vous ne connaissez jamais son mot de passe.**

## 3. Quand le relais de courriel n'est pas encore branché

C'est le cas le jour de l'installation, et c'est pour cela que le repli existe.

- [ ] « Afficher le lien » montre le lien d'invitation en clair
- [ ] L'écran vous prévient que ce lien vaut pour choisir le mot de passe, et
      que son affichage est enregistré dans le journal avec votre nom
- [ ] Vous transmettez le lien comme vous voulez, la personne l'utilise et se
      connecte
- [ ] Vous redemandez un lien pour la même personne : **l'ancien ne marche
      plus**. Un lien noté sur un coin de table cesse de valoir.

## 4. Une personne sans adresse de courriel

Une quote-part peut appartenir à quelqu'un qui n'ouvrira jamais l'application.

- [ ] Vous créez quelqu'un sans adresse : l'application dit qu'il n'a pas de
      compte, qu'il compte pour les quotes-parts, et quoi faire pour lui en
      ouvrir un
- [ ] Sa ligne affiche « Sans compte », pas « Invitation en attente »
- [ ] Le bouton « Renvoyer l'invitation » **n'apparaît pas** sur sa ligne : il
      n'y a rien à renvoyer

## 5. Le second gérant, qui est obligatoire

C'est la porte de secours. Si votre mère perd son accès et qu'elle est seule
gérante, plus personne ne peut arbitrer une demande ni saisir un séjour, et la
seule issue est une restauration de sauvegarde.

- [ ] Tant qu'une structure n'a qu'un gérant, la carte **Pour démarrer** le
      signale, avec une pastille rouge, et la carte ne se masque pas
- [ ] Vous désignez un second gérant : le signalement disparaît
- [ ] Vous essayez de le retirer : **c'est refusé**, avec un message qui nomme
      la structure et dit quoi faire
- [ ] La gérante ne peut pas non plus se retirer elle-même
- [ ] À trois gérants, le retrait passe
- [ ] Un rôle retiré coupe l'accès **tout de suite**, sans attendre l'expiration
      d'un jeton : la personne rétrogradée qui recharge sa page ne voit plus
      l'écran des personnes

## 6. Le mot de passe oublié, qui sert aussi de premier mot de passe

- [ ] Une personne créée il y a trois semaines, dont l'invitation a expiré,
      passe par « mot de passe oublié » depuis l'écran de connexion et obtient
      un lien. Elle n'a pas besoin de vous.

---

## Ce qui a été corrigé, et pourquoi c'est important

**Le parcours d'inscription était une impasse.** La route qui crée une personne
annonçait, dans son propre commentaire, que la personne choisirait son mot de
passe par « mot de passe oublié ». Or cette route-là cherchait le compte avec
`mot_de_passe_hash IS NOT NULL`, et une personne fraîchement créée n'a
précisément pas d'empreinte. Résultat : la personne était créée, la demande de
mot de passe répondait « c'est envoyé » (par construction, pour ne pas révéler
qui a un compte), et **rien ne partait jamais**.

Aucun test ne l'avait vu parce que le banc d'essai contournait le trou : sa
fonction d'aide écrivait l'empreinte directement en base, « sans passer par le
courriel ». Les tests de `backend/test/invitations.test.ts` passent désormais
**par les routes**, et vont jusqu'à la connexion effective. Un parcours
d'inscription qui n'est pas suivi jusqu'à la connexion n'est pas testé.

**Le tiret cadratin était dans l'interface**, à sept endroits, comme valeur
vide, dont un sur le tableau de bord. Une valeur vide se dit maintenant avec un
mot (« Aucun », « Non renseigné », « Sans quota »), qui se lit à voix haute et
qu'un lecteur d'écran énonce. Un test de CI refuse le caractère dans le code et
la documentation.

## Le prix du repli, dit franchement

Afficher un lien d'invitation en clair, c'est pouvoir choisir le mot de passe de
quelqu'un d'autre. Vous l'avez demandé pour le jour de l'installation, et c'est
le bon compromis, mais il se paie. Trois contreparties :

1. l'affichage est réservé au gérant ;
2. il est daté en base et écrit au journal, avec le nom de qui a regardé ;
3. chaque demande engendre un jeton neuf qui périme le précédent.

Si vous voulez vérifier après coup qui a affiché quel lien :

```bash
sqlite3 /var/lib/maison-de-famille/mdf.db \
  "SELECT r.vu_le, p.nom AS pour, g.nom AS par
     FROM reinit_mot_de_passe r
     JOIN personne p ON p.id = r.personne_id
     LEFT JOIN personne g ON g.id = r.cree_par
    WHERE r.vu_le IS NOT NULL ORDER BY r.vu_le DESC;"
```

```bash
journalctl -u maison-de-famille | grep "affiché en clair"
```
