# Recette de la tranche 2

Ce que vous vérifiez vous-même, par l'usage. C'est de l'argent entre frères et
soeurs : le critère n'est pas que les chiffres soient justes, c'est que vous
puissiez **les expliquer à quelqu'un qui les conteste**, sans ouvrir le code.

**En une phrase : vous saisissez la taxe foncière, la répartition suit les
quotes-parts, et vous affichez le détail du calcul en un clic.**

---

## 1. La répartition

- [ ] Vous saisissez une taxe foncière de 2 340 € avancée par votre mère
- [ ] Les trois indivisaires portent 780 € chacun
- [ ] Cliquer la ligne ouvre le détail : la règle appliquée, la date des parts
      retenues, la fraction de chacun, la méthode d'arrondi, et le contrôle
      « la somme des parts vaut 2 340,00 € »
- [ ] Le total de l'en-tête est exactement la somme des lignes affichées

## 2. Le point qui compte : le passé reste juste

- [ ] Vous modifiez une quote-part avec une **date d'effet postérieure** à une
      dépense déjà saisie
- [ ] La dépense antérieure garde sa ventilation d'origine, au centime
- [ ] Une dépense saisie **après** suit la nouvelle répartition
- [ ] Vous changez la règle d'une catégorie : les dépenses passées ne bougent pas,
      et l'écran le dit avant que vous cliquiez

## 3. Le recalcul, quand vous le demandez

- [ ] Le recalcul exige un motif : sans motif, le bouton reste inactif
- [ ] Après recalcul, le motif et sa date apparaissent sous le détail
- [ ] L'ancienne répartition est conservée (vérifiable dans la base, table
      `ventilation_recalcul`)

## 4. Les soldes

- [ ] Chaque personne a un solde, positif ou négatif, avec une phrase qui
      l'explique en français
- [ ] Le compte commun apparaît comme un acteur à part entière quand il a payé
- [ ] Aucun bandeau « Incohérence détectée » : la somme des soldes vaut zéro
- [ ] Le détail de chaque carte montre ce qui a été avancé, ce qui est dû, et ce
      qui a été réglé

## 5. Les virements

- [ ] Le nombre de virements proposés est minimal (trois débiteurs vers une
      créancière donnent trois virements, pas une chaîne)
- [ ] Un virement proposé ne déplace aucun solde
- [ ] Vous annoncez un virement : il passe en « Annoncé », les soldes ne bougent
      toujours pas
- [ ] **Le bénéficiaire seul peut confirmer.** Essayez de confirmer un virement
      dont vous n'êtes pas le destinataire : c'est refusé, avec un message clair
- [ ] Une fois confirmé, les deux soldes concernés retombent à zéro

## 6. L'appel de fonds

- [ ] L'appel ne liste que les débiteurs, jamais les créanciers
- [ ] Chaque personne concernée reçoit un courriel avec son montant, l'échéance
      et un lien vers le détail du calcul
- [ ] Un appel sans débiteur est refusé, plutôt qu'émis vide

## 7. Les justificatifs

- [ ] Vous joignez une photo ou un PDF à une dépense
- [ ] Le lien « Voir le justificatif » l'ouvre
- [ ] Un membre qui ne voit pas la dépense ne voit pas non plus son justificatif,
      même en collant l'adresse du fichier

## 8. La portée

- [ ] Un membre de foyer ne voit ni les dépenses ni les soldes (défaut prudent)
- [ ] Les entrées « Dépenses » et « Soldes » n'apparaissent pas dans sa
      navigation : on ne lui propose pas une porte fermée
- [ ] Vous activez `Les membres de foyer voient les dépenses` dans les réglages :
      la liste lui devient visible

## 9. Le vocabulaire suit la structure

- [ ] Sur l'indivision, les virements portent « Régularisation d'indivision »
- [ ] Sur la SCI, ils portent « Appel de fonds de la SCI », et les détenteurs
      s'appellent des associés avec des parts sociales

## 10. La réversibilité

- [ ] L'export CSV des dépenses s'ouvre dans Excel du premier coup
- [ ] Il contient **une ligne par dépense et par personne**, avec la règle
      appliquée et la part due
- [ ] Les montants sont reconnus comme des nombres, pas comme du texte

---

## Ce qui n'est pas dans cette tranche

- Une dépense qui sert à **deux structures** (l'assurance des deux biens, alors
  que l'un est en indivision et l'autre en SCI) s'enregistre en **deux
  dépenses**. L'application le refuse explicitement et dit pourquoi : l'argent
  est dû dans deux pots distincts, et une dépense de SCI n'entre jamais dans les
  comptes de l'indivision. Le regroupement à l'affichage est prévu au schéma
  (`depense_groupe`) et sera livré quand le second bien existera pour de vrai.
- Le PDF d'appel de fonds. Le courriel porte le montant, l'échéance et le lien
  vers le détail ; le document imprimable viendra si vous en avez l'usage.
