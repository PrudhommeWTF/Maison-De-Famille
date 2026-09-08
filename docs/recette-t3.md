# Recette de la tranche 3

Ce que vous vérifiez vous-même, par l'usage.

**En une phrase : un membre de foyer voit le guide d'arrivée mais pas la
convention d'indivision, et un code de portail affiché pendant un séjour ne
l'est plus le lendemain du départ.**

---

## Avant tout : la clé du coffre-fort

Les codes d'accès sont chiffrés. La clé vit dans le fichier d'environnement,
**hors du répertoire de données**, et il faut la poser avant d'enregistrer le
premier code :

```bash
openssl rand -hex 32
# à coller dans MDF_CLE_COFFRE dans /etc/maison-de-famille/mdf.env
systemctl restart maison-de-famille
```

- [ ] Sans cette clé, l'écran Coffre-fort le dit clairement et les documents
      restent accessibles : seuls les codes sont indisponibles
- [ ] Une fois la clé posée, le bouton « Ajouter » apparaît dans « Codes et accès »

**Gardez une copie de cette clé ailleurs que dans vos sauvegardes du répertoire
de données.** Sans elle, une restauration rend tout sauf les codes. C'est
volontaire : c'est ce qui fait qu'une sauvegarde qui traîne ne contient aucun
code.

## 1. Le carnet d'entretien

- [ ] Vous créez la récurrence « Ramonage de la cheminée, tous les ans, avant le
      15 octobre » : la tâche apparaît immédiatement, avec sa date limite
- [ ] Elle n'invente **aucune** échéance antérieure au jour où vous l'avez créée
- [ ] Une échéance dépassée s'affiche en rouge, avec « En retard depuis le »
- [ ] Vous cochez la tâche : l'application **demande la date de réalisation**,
      accepte un coût et une facture, et refuse une date dans le futur
- [ ] La tâche passe à l'historique avec la date que vous avez saisie, pas celle
      du jour du clic. C'est ce qui fait un carnet d'entretien opposable.
- [ ] Vous relisez l'écran trois fois : les occurrences ne s'empilent pas

## 2. La checklist de départ

- [ ] Vous ajoutez trois lignes (compteur d'eau, volets, poubelles)
- [ ] La veille de la fin d'un séjour, l'occupant reçoit un courriel qui
      **contient les lignes**, pas seulement un lien : on ferme une maison une
      clé à la main, parfois sans réseau
- [ ] Le courriel ne part qu'une fois, même si le service redémarre
- [ ] Sans aucune ligne, rien ne part, et l'écran vous le dit

## 3. La fiche du bien

- [ ] Vous remplissez le guide d'arrivée : clés, eau, poubelles, voisins, wifi
- [ ] Un membre de foyer le voit
- [ ] Le guide ne contient **pas** les codes : ils vivent au coffre-fort avec
      leur propre portée et leur propre journal
- [ ] Vous signalez une casse : une tâche « Remplacer... » apparaît dans le
      carnet d'entretien et la ligne d'inventaire passe à « À remplacer »
- [ ] Un membre de foyer peut signaler une casse (celui qui casse un matelas
      n'est pas celui qui gère le bien)

## 4. Le carnet d'adresses

- [ ] Vous enregistrez le plombier, avec son numéro et une note
- [ ] Un membre de foyer le voit et peut appeler d'un doigt depuis son téléphone
- [ ] Un membre de foyer **ne peut pas** modifier le carnet
- [ ] Un invité ne voit pas le carnet du tout

## 5. Le coffre-fort, et la règle qui compte

- [ ] Un document de portée « Détenteurs » (la convention d'indivision)
      n'apparaît pas pour un membre de foyer, **y compris en tapant l'adresse
      directement**
- [ ] Un document de portée « Tous les membres » (l'attestation d'assurance)
      apparaît
- [ ] Déposer à nouveau un document ajoute une version : l'ancienne reste
      consultable
- [ ] La liste des codes n'affiche **jamais** la valeur : il faut cliquer
      « Afficher », code par code
- [ ] Chaque affichage est enregistré, et « Journal » vous dit qui a regardé et
      quand

**Le test qui compte vraiment**, avec un code de portée « Pendant le séjour » :

- [ ] Trois jours avant l'arrivée : le code n'est pas visible
- [ ] Deux jours avant : il l'est (on prépare un départ à l'avance)
- [ ] Pendant le séjour : il l'est
- [ ] **Le jour du départ : il l'est encore** (il faut refermer derrière soi)
- [ ] **Le lendemain du départ : il ne l'est plus**, et le refus explique
      pourquoi au lieu de prétendre que le code n'existe pas

La fenêtre se règle dans **Administration**, Réglages, section Sécurité : « Jours d'avance sur
un code de séjour » et « Jours de grâce après un départ ». Le second vaut zéro
par défaut, et c'est le point.

---

## Retrouver qui a affiché quoi

Depuis l'application, le bouton « Journal » sur chaque code. En ligne de
commande, si vous préférez :

```bash
sqlite3 /var/lib/maison-de-famille/maison.db \
  "SELECT a.affiche_le, p.nom, c.libelle, b.nom
     FROM code_affichage a
     JOIN personne p ON p.id = a.personne_id
     JOIN code_acces c ON c.id = a.code_id
     JOIN bien b ON b.id = c.bien_id
    ORDER BY a.affiche_le DESC LIMIT 50;"
```

```bash
journalctl -u maison-de-famille | grep "Code .* affiché"
```

## Ce que le chiffrement protège, et ce qu'il ne protège pas

Il faut le dire exactement, sinon la mesure donne une confiance qu'elle ne
mérite pas.

**Protégé** : une base de données qui fuit, une sauvegarde recopiée sur un NAS,
un disque de conteneur exfiltré. Aucun de ces cas ne rend un seul code, parce
qu'aucun ne contient la clé.

**Non protégé** : quelqu'un qui obtient la racine sur la machine lit la clé
comme le reste. C'est une frontière réelle, ce n'est pas un coffre-fort.

Vous pouvez le vérifier vous-même :

```bash
grep -a "1840B" /var/lib/maison-de-famille/maison.db   # ne trouve rien
```
