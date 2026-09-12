# Faisabilité de Wikisource

Audit du 12 septembre 2026. Recherche et essais en lecture seule ; **aucun plugin Wikisource enregistré ni activé**. Les autres sources doivent encore être validées avec le propriétaire du projet.

## Conclusion

Wikisource est une bonne prochaine source, notamment pour compléter le catalogue français. Sa recherche fonctionne directement depuis GitHub Pages dans les six langues de FastReader. L’export EPUB fonctionne côté serveur et le fichier essayé s’importe correctement dans FastReader. Cependant, **WS Export ne permet pas actuellement à notre navigateur de lire la réponse EPUB par CORS** : il faut un relais hébergé pour offrir le parcours complet « Lire → bibliothèque → lecteur » avec cet exporteur. Un second essai décrit en fin de rapport a ensuite confirmé une autre voie : **fabriquer localement l’EPUB à partir des API HTML officielles**, sans WS Export ni relais, fonctionne pour l’édition complète française testée.

L’autre difficulté concerne le catalogue : un résultat de recherche Wikisource peut être un chapitre, une page de désambiguïsation, un poème, une édition complète ou un volume. Proposer tous les résultats comme des livres dégraderait fortement l’expérience. Recommandation : démarrer par des éditions complètes vérifiées et indexées, puis élargir avec des règles adaptées à chaque wiki linguistique.

## Essais réseau réels

Les requêtes HTTP locales utilisaient un User-Agent identifiant le projet et `Origin: https://drslid.github.io`. L’essai Chromium utilisait une page minimale à cette même origine, sans modifier le site public, `credentials: omit` et l’en-tête `Api-User-Agent`. Les requêtes API ont été effectuées successivement avec des limites de trois à cinq résultats ; aucun parcours massif du catalogue.

| Essai | Résultat observé |
| --- | --- |
| Recherche FR, « Horla » | HTTP 200 ; 213 ms ; 49 pages trouvées |
| Recherche EN, « Pride and Prejudice » | HTTP 200 ; 182 ms ; 128 pages trouvées |
| Recherche ES, « Don Quijote » | HTTP 200 ; 198 ms ; 177 pages trouvées |
| Recherche IT, « Pinocchio » | HTTP 200 ; 173 ms ; 75 pages trouvées |
| Recherche DE, « Die Verwandlung » | HTTP 200 ; 212 ms ; 6 pages trouvées |
| Recherche PT, « Dom Casmurro » | HTTP 200 ; 217 ms ; 150 pages trouvées |
| Export FR depuis le serveur | HTTP 200, `application/epub+zip`, 205 269 octets, 1,66 s |
| Même export depuis Chromium / origine Pages | `Failed to fetch` ; console : absence d’`Access-Control-Allow-Origin` |
| Métadonnées et HTML de l’édition FR | HTTP 200 avec `Access-Control-Allow-Origin: *` |
| Vignette de la couverture FR | HTTP 200, JPEG, 26 437 octets, CORS `*` |

Ces durées sont des mesures ponctuelles, pas des garanties de performance. Les nombres de résultats sont des **pages**, pas des livres. Les cinq autres langues ont été vérifiées pour la recherche ; leurs exports et métadonnées n’ont pas été validés dans cet audit.

Format de recherche testé :

```text
https://{fr|en|es|it|de|pt}.wikisource.org/w/api.php
  ?action=query&format=json&formatversion=2&origin=*
  &list=search&srnamespace=0&srsearch=intitle:"Horla"
  &srlimit=3&maxlag=5
```

La documentation MediaWiki autorise les [requêtes CORS anonymes avec `origin=*`](https://www.mediawiki.org/wiki/API:Cross-site_requests). Les bonnes pratiques demandent notamment [identification du client, requêtes groupées/successives, cache et prise en compte de la charge](https://www.mediawiki.org/wiki/API:Etiquette).

L’accueil de WS Export a renvoyé une page Anubis « Access Denied » au robot de consultation web de l’audit. La requête ordinaire sur l’URL officielle d’export, depuis notre environnement local, a fonctionné sans challenge, authentification ou modification d’identité. Ce résultat ne permet donc de conclure ni à une panne globale du service ni à sa disponibilité depuis tout futur hébergeur. Aucune protection n’a été contournée.

## Édition complète essayée

[Le Horla — recueil, Ollendorff 1895](https://fr.wikisource.org/wiki/Le_Horla_(recueil,_Ollendorff_1895)), de Guy de Maupassant, page Wikisource **4227**, révision visible **7351446**, élément Wikidata **Q51955141**.

URL d’export testée :

```text
https://ws-export.wmcloud.org/?lang=fr&page=Le+Horla+%28recueil%2C+Ollendorff+1895%29&format=epub-3
```

L’archive téléchargée a été importée dans le site public FastReader dans un profil Chromium isolé. Le lecteur s’est ouvert en 849 ms, sans erreur JavaScript. L’auteur a été conservé et le livre apparaît en bibliothèque. Le sommaire contient 17 entrées : couverture, sommaire du recueil, les 14 nouvelles attendues et la notice « À propos ». Cette vérification porte sur la présence des textes/entrées et leur import ; elle ne constitue pas une relecture intégrale de l’édition.

Le [fonctionnement documenté de WS Export](https://wikisource.org/wiki/Wikisource:WS_Export/en) repose sur le sommaire `.ws-summary`, puis sur les liens vers les sous-pages lorsque ce balisage manque. Un lien d’export valide ne garantit donc pas à lui seul la complétude de n’importe quel ouvrage.

Le code maintenu a quitté GitHub pour [GitLab Wikimedia / wsexport](https://gitlab.wikimedia.org/toolforge-repos/wsexport). Ne pas prendre le dépôt GitHub archivé comme preuve d’un abandon du service.

## Catalogue, auteur et couverture

La recherche FR simple renvoyait aussi `Le Horla (recueil)`, page listant plusieurs éditions, ainsi que des nouvelles à l’intérieur des recueils. Les essais EN, IT et PT faisaient apparaître des chapitres parmi les trois premiers résultats. `srnamespace=0` est nécessaire mais insuffisant. Rejeter tous les titres contenant `/` serait également incorrect : un volume ou une œuvre autonome peut être une sous-page.

Pour l’édition française essayée :

- La requête `prop=pageprops|pageimages|info|categories|revisions` donne l’identifiant stable, l’URL, Wikidata et les catégories `Bon pour export` / `Textes validés`, **mais aucune couverture via `pageimages`**.
- `action=parse&prop=text` donne les balises `ws-type=collection`, `ws-title`, `ws-author=Guy de Maupassant`, `ws-year=1895`, `ws-scan`, `ws-cover=Maupassant - Le Horla.djvu/7` et un sommaire de 14 liens. Le HTML reçu ne contient pas d’image de couverture à réutiliser directement.
- La couverture est la page 7 du fac-similé, obtenue avec `prop=imageinfo`, `titles=File:Maupassant - Le Horla.djvu`, `iiprop=url|mime|extmetadata`, `iiurlwidth=320`, `iiurlparam=page7-320px` sur l’API FR. L’API résout le fichier partagé sur Commons, même si sa page locale est marquée `missing: true, known: true`.
- La réponse désigne actuellement `thumb.wikimedia.org` pour la vignette et `upload.wikimedia.org` pour le fichier original. Les deux domaines doivent être traités explicitement dans une future politique de transport ; ne pas autoriser un domaine arbitraire fourni par une notice.

La [spécification des microformats Wikisource](https://wikisource.org/wiki/Wikisource:Microformat) décrit ces champs, mais ils sont optionnels. [Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo) documente les paramètres de vignette multipage. Il faut garder une couverture typographique avec titre complet et auteur lorsque les informations manquent, puis conserver la même identité visuelle après import.

Pour un premier plugin fiable, une notice vérifiée devrait identifier langue, page/édition, titre, auteur, couverture du bon fac-similé, source des droits et résultat de l’essai d’export. Les catégories et badges de correction peuvent servir à présélectionner des candidats ; ils ne remplacent pas la validation de leur structure. Il ne faut pas inventer des équivalents uniformes des catégories FR pour les cinq autres langues.

## Provenance et droits

Wikisource contient des textes du domaine public **et** des textes sous licence libre ; il ne faut pas marquer tout le catalogue « domaine public mondial ». La [politique officielle](https://en.wikisource.org/wiki/Wikisource:Copyright_policy) et les [règles de réutilisation](https://en.wikisource.org/wiki/Wikisource:Reusing_Wikisource_content) distinguent ces situations. Les traductions ont un [statut propre à vérifier](https://en.wikisource.org/wiki/Wikisource:Translations), et les couvertures/illustrations peuvent avoir leurs propres mentions.

Sur le spécimen reçu, l’OPF annonce CC BY-SA 3.0 et GFDL ; la notice de crédits est incluse. La réponse Commons associe le fac-similé à « Public domain » et à sa page de description. Conserver la provenance Wikisource, l’auteur, les crédits et les notices reçues, y compris après export Focus/Classique ; ne pas déduire du seul OPF une qualification juridique uniforme du texte original ou du catalogue.

## Choix proposé pour l’intégration

1. Valider Wikisource avec le propriétaire et commencer par une sélection d’éditions complètes françaises, avec auteur/couverture contrôlés.
2. Choisir le chemin de lecture : intégrer le convertisseur local pour ce périmètre contrôlé, ou héberger un relais pour utiliser WS Export. Le premier évite tout hébergement supplémentaire ; le second réutilise un exporteur plus général. Dans les deux cas, respecter le contrat de source, valider les identifiants, limiter les hôtes, tailles, durées et redirections, et conserver les échecs lisibles côté utilisateur.
3. Tester cette sélection de bout en bout : recherche, couverture, téléchargement, import, navigation de tous les chapitres, crédits, reprise hors ligne et export. Le présent audit vérifie un seul EPUB, pas un plugin prêt à publier.
4. Élargir progressivement par langue avec des règles d’éditions et des essais représentatifs.

Une fabrication locale d’EPUB à partir des API HTML autorisées évite de dépendre du CORS de WS Export, comme l’essai complémentaire ci-dessous le démontre sur une édition. Il reste à transformer cette preuve en convertisseur délimité et testé : sommaire, récursion bornée, images, liens, notes, crédits, langues et livre incomplet. Ce n’est pas une petite option de transport, ni une fonctionnalité déjà disponible dans l’application publiée.

Les traces ponctuelles de l’audit restent dans `/tmp/fastreader-wikisource-audit/` sur l’environnement de travail ; elles ne sont pas un jeu de données embarqué ou publié.

## Essai complémentaire : EPUB créé localement, sans relais

Un prototype temporaire, extérieur à `src/`, a été exécuté dans Chromium depuis une page minimale à l’origine `https://drslid.github.io`. JSZip et DOMPurify proviennent des dépendances déjà installées du projet. Le navigateur a téléchargé les données directement auprès des API Wikimedia, puis créé l’archive EPUB lui-même ; aucune URL d’export, aucun proxy, aucun serveur de conversion et aucune source externe au périmètre Wikimedia n’ont été utilisés pour cette fabrication.

Le prototype charge la page racine du recueil, exige son sommaire explicite de 14 nouvelles, puis charge successivement ces 14 pages par `action=parse`. Il conserve les révisions, réécrit les liens entre les fichiers, intègre la couverture via `imageinfo`, retire les éléments de navigation et produit les documents XHTML, le sommaire EPUB 3, le manifeste et le spine. Une structure de sommaire imbriquée ou une image intérieure non prise en charge provoque un échec explicite dans ce prototype limité ; aucun chapitre n’est ignoré silencieusement.

La notice de crédits comprend l’auteur, l’édition, les liens vers les 15 pages Wikisource et leurs révisions, les 323 pages transcrites mentionnées dans le HTML, la provenance et les mentions Commons de la couverture, ainsi que la licence éditoriale fournie par `meta=siteinfo&siprop=rightsinfo`. Les [conditions officielles de Wikimedia, section 7](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content) admettent l’attribution par URL des pages réutilisées et demandent de conserver les mentions particulières et d’indiquer les modifications. Le prototype distingue le texte original du domaine public des contributions éditoriales sous licence ; une intégration générale devra traiter les licences particulières à l’édition.

Dernier essai :

| Vérification | Résultat |
| --- | --- |
| Fabrication entièrement dans le navigateur | 4 496 ms, 150 719 octets |
| Requêtes de contenu | 17 GET API + 1 JPEG ; uniquement `fr.wikisource.org` et `thumb.wikimedia.org` |
| Archive obtenue | EPUB 3, 17 entrées de lecture ; fichier `mimetype` premier et non compressé |
| Validité XML | 20 documents XML/XHTML/OPF analysés sans erreur |
| Intégrité des 14 nouvelles | **1 458 paragraphes identiques**, après normalisation des espaces et retrait des numéros de page, à l’export WS Export de référence déjà téléchargé |
| Liens internes du nouvel EPUB | Aucun fichier ou fragment introuvable |
| Images | Couverture incorporée ; aucune image distante nécessaire à la lecture |
| Import dans FastReader public | 227 ms ; titre et auteur conservés ; 17 entrées ; livre ajouté en bibliothèque ; aucune erreur JavaScript |

Une première comparaison a détecté un avertissement de maintenance MediaWiki ajouté après le texte du « Diable ». Le filtre du prototype a été corrigé pour supprimer ce bloc technique précis, puis la fabrication, l’import et la comparaison des 14 textes ont été relancés avec succès. Les requêtes d’export WS Export antérieures n’ont servi qu’à obtenir la référence de comparaison, jamais au parcours API → EPUB local.

**Seuil raisonnable pour une première intégration :** des éditions françaises contrôlées, avec sommaire explicite, contenu textuel pris en charge, métadonnées connues et attribution préservée. Sur ce périmètre, le transport CORS n’est plus bloquant et le cœur d’assemblage réutilise les dépendances existantes. Il reste à développer le contrat du plugin, la recherche de candidats admissibles, les limites d’ensemble, l’annulation/progression, les erreurs réseau, la stabilité des identifiants et les tests mobile/WebKit/hors ligne. Le filtrage de recherche doit éviter de promettre un EPUB pour une page que ce convertisseur ne sait pas traiter.

**Au-delà de ce seuil :** un convertisseur universel pour les six Wikisource est un chantier plus important. Les volumes imbriqués, œuvres autonomes en sous-page, images et licences variées, mathématiques, tableaux complexes, transclusions et conventions de métadonnées par langue nécessitent des règles et des exemples supplémentaires. La réussite de ce seul recueil n’établit pas cette compatibilité générale, ni une validation EPUBCheck, ni la compatibilité de toutes les liseuses physiques.

Prototype, EPUB et preuves : `/tmp/fastreader-wikisource-local/prototype.js`, `run.mjs`, `horla-local.epub`, `result.json`, `import.json` et `comparison.json`. Aucune activation ni modification de l’application de production.
