# Recette de la tranche 1

Ce que vous vérifiez vous-même, par l'usage. Comptez une demi-heure, avec votre
mère devant l'écran pour les trois premiers points : c'est elle qui décidera si
l'outil est adopté.

**En une phrase : votre mère se connecte, voit le calendrier des deux biens, et
comprend l'écran sans que vous lui expliquiez.**

---

## Avant de commencer

- [ ] `curl -s http://127.0.0.1:8099/api/sante` répond `{"ok":true,...}`
- [ ] `MDF_PUBLIC_URL` et le relais SMTP sont renseignés, service redémarré
- [ ] **Administration**, section « Courriel », montre le relais SMTP, et zéro courriel en attente

---

## 1. La première installation

- [ ] Sur une instance vierge, l'application propose **directement** de créer le
      premier compte, sans passer par un formulaire de connexion vide
- [ ] Un mot de passe de moins de douze caractères est refusé, avec un message
      qui propose une solution (« une phrase dont vous vous souvenez »)
- [ ] Une fois créée, l'instance vous connecte et affiche le tableau de bord
- [ ] Recharger la page ne vous déconnecte pas

## 2. La famille et les biens

- [ ] Vous créez le second bien (SCI), il apparaît dans la barre de contexte
- [ ] Vous créez les autres personnes, chacune avec son adresse de courriel
- [ ] Chacune reçoit un courriel de mot de passe oublié et choisit le sien
- [ ] Vous saisissez la répartition des parts avec **la vraie date d'effet**
      (celle de la succession, pas celle du jour), et l'historique l'affiche

## 3. Le calendrier, l'écran qui remplace l'Excel

- [ ] Votre mère ouvre le calendrier et comprend les couleurs sans la légende
- [ ] Un séjour du 8 au 16 août colore huit nuits, et **pas** le 16
- [ ] Une location du 1er au 8 et un séjour du 8 au 16 ne se chevauchent pas :
      la rotation le même jour est le cas nominal en août
- [ ] La navigation de mois fonctionne, y compris de décembre à janvier

## 4. Les demandes et l'arbitrage

- [ ] Vous demandez un séjour qui chevauche : **le conflit apparaît avant
      l'envoi**, avec le nom du séjour en cause et les nuits concernées
- [ ] La demande part quand même, et votre mère la voit dans sa file avec le
      même avertissement
- [ ] Elle valide : vous recevez le courriel, avec un lien qui ouvre
      directement le bon écran
- [ ] Le calendrier est à jour pour tout le monde, sans rechargement manuel
- [ ] Elle renvoie une autre demande avec un message : le demandeur le reçoit
- [ ] Elle annule une décision : la demande revient en attente

## 5. Le cas réel : les appels téléphoniques

- [ ] Votre mère saisit un séjour **pour quelqu'un d'autre** en deux gestes,
      et il naît validé, sans passer par la file d'attente
- [ ] Elle pose une semaine de location, elle bloque les dates comme un séjour
- [ ] Elle pose une intervention d'entretien, elle bloque aussi

## 6. La reprise du planning existant

- [ ] L'import reconnaît votre fichier et propose une correspondance de colonnes
- [ ] La simulation dit combien de lignes seront créées, combien sont déjà là,
      et **pourquoi** chaque ligne refusée l'est, avec son numéro de ligne
- [ ] Rien n'est écrit tant que vous n'avez pas confirmé
- [ ] Relancer le même fichier ne crée aucun doublon
- [ ] Annuler l'import retire les séjours du calendrier, sans rien effacer

## 7. La règle la plus importante

- [ ] Un membre rattaché à un seul bien **ne voit pas l'autre** dans la barre
      de contexte
- [ ] En tapant directement l'adresse de l'autre bien, il obtient un refus
      clair, pas un écran vide ni une erreur technique
- [ ] Son calendrier consolidé ne contient que son bien
- [ ] Son export CSV ne contient que son bien

## 8. Les quotes-parts dans le temps

- [ ] Vous saisissez une nouvelle répartition avec une date d'effet **passée**
- [ ] L'historique montre les deux périodes, avec leur motif
- [ ] Un changement daté **avant** une répartition déjà saisie est refusé, avec
      un message qui dit quoi faire

## 9. Le mobile

- [ ] Sur téléphone, la barre d'onglets basse est utilisable au pouce
- [ ] Le calendrier reste lisible, la page ne défile pas horizontalement
- [ ] Une demande de séjour se saisit entièrement au doigt

## 10. La réversibilité

- [ ] L'export CSV des séjours s'ouvre dans Excel **du premier coup**, accents
      compris, colonnes séparées
- [ ] L'export complet se restaure sur une instance vierge, et vous y retrouvez
      les mêmes personnes, biens et séjours
      (voir `docs/sauvegarde-restauration.md`)

## 11. Ce qu'on n'oublie pas

- [ ] Le second facteur s'active, les codes de secours s'impriment, et la
      session reste ouverte juste après (pas d'écran d'erreur)
- [ ] Après six essais de mot de passe faux, la connexion se temporise
- [ ] « Mot de passe oublié » répond la même chose pour une adresse connue et
      une adresse inconnue

---

## Si quelque chose ne va pas

```bash
journalctl -f -u maison-de-famille          # ce que fait le service
```

L'écran **Administration** dit le reste : version du schéma, relais SMTP, file
des courriels avec le message d'erreur exact du relais.

Les messages d'erreur de l'application sont écrits pour être lus par la famille.
Si l'un d'eux ne vous dit pas quoi faire, c'est un défaut : signalez-le.
