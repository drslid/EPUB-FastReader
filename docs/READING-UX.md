# Lecture, repères et reprise : décisions de conception

Recherche vérifiée le 10 septembre 2026. Cette note sépare les résultats publiés, les conventions d'autres lecteurs et les choix de produit à valider avec des utilisateurs. Aucune étude citée ne désigne une interface universellement supérieure.

## Ce que permettent de conclure les recherches

La synthèse de Rayner et collègues décrit le compromis entre vitesse et compréhension : promettre de lire deux ou trois fois plus vite en comprenant autant n'est pas étayé pour le grand public. La présentation d'un mot à la fois retire aussi la possibilité de revenir spontanément sur une phrase. Une expérience de Schotter et collègues montre que supprimer les retours en arrière peut dégrader la compréhension, même hors des phrases ambiguës. Ces travaux justifient de conserver un texte continu facile à relire. [Synthèse APS, 2016](https://www.psychologicalscience.org/publications/speed_reading.html), [étude de Schotter, Tran et Rayner, 2014](https://www.psychologicalscience.org/journals/psychological-science/0956797614531148/).

Une étude de 2024 portant sur 32 étudiants néerlandophones et 100 courts paragraphes ne trouve pas de différence significative de vitesse entre le texte ordinaire et des débuts de mots en gras. Son échantillon et ses tâches ne permettent pas de conclure pour toutes les personnes ou tous les livres. Le mode Focus peut donc rester une préférence visuelle, sans promesse d'accélération ni bénéfice médical. [Joshua Snell, _Acta Psychologica_, 2024](https://doi.org/10.1016/j.actpsy.2024.104304).

Les résultats dépendent aussi du public. Une étude publiée le 24 novembre 2025 observe un bénéfice de compréhension en RSVP chez des étudiants avec un TDAH, comparativement aux deux autres présentations testées. L'expérience utilise de courts paragraphes; elle ne démontre ni un gain de vitesse généralisable, ni une meilleure expérience de lecture de romans, ni un traitement. C'est un argument pour offrir un choix, avec un réglage individuel, plutôt que pour imposer ce mode. [Moussaoui et collègues, _Journal of the International Neuropsychological Society_, 2025](https://doi.org/10.1017/S1355617725101628).

## Interface de lecture retenue

Les choix suivants sont des décisions de conception à tester, pas des effets scientifiques démontrés pour FastReader. Le mode initial Mot à mot, le thème Sépia et Verdana répondent à la demande du produit. Les utilisateurs peuvent changer de mode pendant la lecture ; chaque ouverture revient au mode Mot à mot, sans démarrage automatique. Le thème clair ou sombre et la police choisis explicitement restent mémorisés. Lorsque le système demande une réduction des mouvements, chaque ouverture utilise Classique. Aucun thème n’est présenté comme une garantie de repos visuel.

| Élément              | Comportement proposé                                                              | Raison                                                                                       |
| -------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Ouverture d'un livre | Mot à mot sélectionné, démarrage explicite, reprise au dernier emplacement        | Choix initial demandé pour ce produit ; le contexte et le texte complet restent accessibles. |
| Modes                | « Mot à mot », « Focus », « Classique » avec aperçu                               | Laisser une préférence personnelle, avec des libellés compréhensibles.                       |
| Commandes            | Modes visibles en haut; commandes de lecture et repères accessibles en bas        | Une seule zone pour les actions courantes sur téléphone et tablette.                         |
| Mot à mot            | Démarrage explicite, bouton pause permanent, vitesse réglable, retour à la phrase | L'utilisateur garde la maîtrise du rythme.                                                   |
| Contexte RSVP        | Phrase courante visible; commande de retour au texte à la même position           | Faciliter la compréhension et la reprise après interruption.                                 |
| Personnalisation     | Taille, police, contraste/thème; mémoriser les préférences                        | Adapter la lecture aux besoins et à l'appareil.                                              |
| Temps restant        | Estimation discrète, sans score ni injonction à accélérer                         | Encourager à lire sans transformer chaque session en performance.                            |

Pour le tactile, viser des commandes de 44 × 44 pixels CSS ou davantage. Le W3C décrit 44 × 44 comme le critère renforcé AAA; le minimum AA de WCAG 2.2 est de 24 × 24, avec exceptions et règles d'espacement. Ici, 44 pixels est un choix de confort, pas une déclaration de conformité complète. Garder un focus clavier visible et un nom accessible pour les icônes. [W3C, taille des cibles renforcée](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), [WCAG 2.2, taille minimale](https://www.w3.org/TR/WCAG22/#target-size-minimum).

La pause doit arrêter durablement le flux et reprendre au même endroit. Le critère W3C sur les contenus qui bougent ou s'actualisent explique les problèmes posés par les changements incontrôlables; son périmètre normatif dépend notamment du démarrage automatique. FastReader peut aller au-delà de ce minimum en permettant toujours de suspendre le mode mot à mot et en le suspendant lorsque l'onglet devient masqué. [W3C, Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide).

## Le marque-page visuel, sans faux numéro de page

Deux intentions doivent être accessibles sans effort : la dernière position se sauvegarde automatiquement; les marques explicites servent à garder les passages auxquels on souhaite revenir. C'est notamment la distinction employée dans Apple Books, qui ouvre également un livre depuis sa couverture et rassemble signets et annotations. Cette observation est une référence d'usage, pas une comparaison expérimentale des interfaces. [Guide officiel Apple Books](https://support.apple.com/en-ie/guide/iphone/iphc1af7c57/ios).

Présentation proposée :

- Dans la bibliothèque, une carte « Reprendre » avec couverture, titre, chapitre et progression.
- Dans le lecteur, une fine barre de progression accompagnée d'un chapitre lisible et d'un pourcentage.
- Dans « Mes repères », une icône de ruban, le chapitre, quelques mots du passage et la note éventuelle. Le texte aide à reconnaître le souvenir plus qu'un simple « 37 % ».
- Un bouton explicite pour enregistrer un passage; état visuel et libellé accessibles indiquant qu'il est gardé.
- Au retour, le passage se retrouve près du haut du texte; le surlignage peut identifier une annotation sans masquer le contenu.

Dans un EPUB adaptable, changer d'écran ou de taille de police change la pagination. Readium utilise des positions stables plutôt que des numéros de pages calculés à partir de l'écran. Afficher « chapitre 4 · 37 % » est donc plus cohérent entre appareils. Un éventuel numéro imprimé doit provenir d'une vraie liste de pages de l'éditeur; des pages calculées ne doivent pas se faire passer pour cette pagination. [Guide Readium, progression et positions](https://github.com/readium/kotlin-toolkit/blob/develop/docs/guides/navigator/navigator.md#displaying-the-number-of-positions).

## Positions et annotations implémentées

`src/reading-location.js` fournit un petit format interne inspiré du principe des localisateurs textuels de Readium, sans prétendre implémenter son schéma complet ou EPUB CFI. Un chapitre, une position dans le texte, une citation et son contexte décrivent ensemble l'emplacement. Les caractères sont comptés en unités UTF-16, comme les offsets des `Range` DOM. Les séparateurs de blocs font partie du texte canonique; les balises du mode Focus n'en font pas partie. [Modèle des localisateurs Readium](https://readium.org/architecture/models/locators/).

```js
{
  version: 1,
  chapterId: "chapter-4",
  textOffset: 1834,
  exact: "Les premiers mots du passage…",
  prefix: "Le contexte précédent…",
  suffix: "Le contexte suivant…",
  progression: 0.37
}
```

- `getTextContent(root)` produit le texte commun au lecteur et au découpage RSVP; les nœuds de script, de style ou explicitement masqués sont exclus.
- `createTextLocator(root, { chapterId, scrollContainer, textOffset?, wordIndex? })` capture une position explicite ou le premier texte visible. Un long paragraphe est inspecté jusqu'au caractère visible, pas seulement à son début.
- `locateTextRange(root, locator)` retrouve la citation; le préfixe et le suffixe départagent des passages répétés. Une citation entièrement supprimée ne produit pas de fausse correspondance.
- `restoreTextLocator(root, locator, scrollContainer)` remet le passage près du haut. Si la citation est introuvable ou n'a pas de géométrie visible, la progression donne une reprise approximative.
- `wordIndexForLocator(root, locator)` permet de passer au mode mot à mot à la position correspondante.
- `createSelectionLocator(root, range, { chapterId })` capture une sélection jusqu'à 2 000 caractères, sans couper une paire UTF-16. La sélection peut traverser plusieurs balises et paragraphes.
- `applyLocatorHighlight(root, locator, { className, id })` ajoute un `mark` par fragment de texte sélectionné. Les paragraphes, liens et emphases restent en place. L'interface reconstruit les marques depuis les données lors du rendu du chapitre.

`locator.progression` est la fraction **du texte du chapitre**, et non la fraction de distance parcourue par la barre de défilement. Les images et les marges peuvent faire diverger ces deux valeurs. Le vieux `scrollRatio` reste un repli de migration; il ne faut pas le réécrire aveuglément dans `locator.progression`. Une reprise par citation est précise pour le même contenu; la reprise par ratio est explicitement approximative. Deux éditions différentes ne partagent pas nécessairement leurs positions.

La restauration doit se faire après le rendu. Un changement de police, de largeur ou de mode doit capturer l'ancre avant modification, puis la restaurer. Le chargement différé d'images peut modifier de nouveau la géométrie : tenir compte de leur taille ou restaurer après leur chargement. Les 15 tests unitaires couvrent la logique et une géométrie simulée. Six tests Playwright valident aussi le moteur avec une vraie mise en page Chromium/WebKit, sur profils PC, téléphone et tablette : restauration après changement de police, largeur et balisage Focus, puis annotations sur plusieurs paragraphes. Ces profils émulent les appareils; ils ne remplacent pas des essais sur le matériel.

## Recherche d’un passage implémentée

Dans « Mes repères », le champ « Retrouver un passage » cherche dans le livre ouvert, sans requête distante. La recherche ignore la casse et les accents, affiche le chapitre et un extrait, puis ouvre le passage choisi. Elle conserve les positions exactes du texte même avec le mode Focus. Les résultats sont limités aux vingt premiers ; affiner la recherche pour cibler davantage.

Cette fonction retrouve des mots ou une citation dont le lecteur se souvient. Elle ne sélectionne pas les « meilleurs » passages d’une histoire et ne remplace pas les décisions de lecture. Le module `src/passage-search.js` partage le texte canonique du moteur de positions et conserve un index local en mémoire pour les recherches suivantes.

## « J'ai dix minutes » : choisir un arrêt, pas un extrait arbitraire

Il est difficile de détecter automatiquement les « bons passages » d'un roman sans interpréter l'histoire et risquer de sauter des éléments. La version utile part de **l'endroit où le lecteur en est déjà**. Elle estime un budget de mots, cherche une fin de section ou de paragraphe près de ce budget et propose « jusqu'à la fin de cette section, environ neuf minutes ». Une ponctuation seule ne prouve pas qu'une scène est finie.

Cette fonction peut fonctionner localement, sans résumé ni IA : structure EPUB, fins de paragraphes, estimation de vitesse et marge de dépassement limitée. S'il n'y a pas de bonne frontière, afficher simplement l'estimation et laisser l'utilisateur s'arrêter. Le repère automatique garde sa place. Cette proposition reste une évolution distincte du moteur de positions livré.

## Vérifier avec des lecteurs

Faire essayer trois tâches sur PC, tablette et téléphone : ouvrir une couverture et commencer, retrouver un passage gardé, puis reprendre après changement de police et d'appareil. Observer le nombre d'actions, les erreurs, la compréhension du libellé de progression et le confort déclaré. Pour comparer les modes, mesurer aussi la compréhension du texte, pas seulement les mots par minute. Une barre en bas, une citation de reprise et un panneau de réglages sont des hypothèses de départ à confronter à ces essais.

## Focus adouci et polices locales — septembre 2026

La présentation officielle de Bionic Reading distingue la quantité de lettres mises en évidence de leur visibilité et propose des variantes plus ou moins marquées. Elle ne prescrit donc pas un contraste de couleur maximal entre les deux parties du mot. C’est une référence de réglage typographique, pas une preuve d’efficacité. [Méthode Bionic Reading, fixation et opacité](https://bionic-reading.com/br-method/).

FastReader conserve un gras normal de 700 pour les préfixes, contre 900 auparavant, et rapproche les couleurs des deux parties. L’aperçu et le lecteur utilisent les mêmes couleurs et la même graisse. Les tests navigateur imposent un contraste d’au moins 4,5:1 de chacune des parties contre le fond, y compris après surlignage, et un écart de couleur volontairement modéré entre préfixe et reste du mot (1,2 à 1,7:1). Ce dernier intervalle est un choix visuel de produit, pas un seuil WCAG. Le réglage système de contraste renforcé conserve le texte uniforme avec préfixes soulignés. [W3C, contraste minimal](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Verdana est le nouveau choix initial ; Arial, Georgia, Palatino, Trebuchet MS et la police de l’appareil sont proposés dans les réglages. Les polices sont locales, avec des familles de remplacement : leur disponibilité dépend du système, aucun fichier commercial n’est redistribué et aucune requête à un fournisseur de polices n’est nécessaire. Les choix explicites enregistrés, y compris ceux d’anciennes sauvegardes, restent prioritaires sur les nouveaux réglages par défaut.
