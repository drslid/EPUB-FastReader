# Standard Ebooks : intégration et vérifications

Mise à jour du 12 septembre 2026 après l’autorisation explicite d’intégration. Le plugin `standard-ebooks` utilise la recherche publique du site et télécharge directement l’EPUB compatible dans le navigateur, y compris depuis GitHub Pages. Il ne dépend ni d’un compte Standard Ebooks, ni de son OPDS restreint, ni du relais FastReader.

## Recherche publique

La [page officielle de recherche](https://standardebooks.org/ebooks) accepte `query`, `per-page` et `page`. Les essais `pride and prejudice`, `frankenstein`, `austen`, `fiction` et une chaîne absente ont renvoyé des pages XHTML exploitables avec `Access-Control-Allow-Origin: *`. La recherche `fiction` a également permis de vérifier les liens de pagination sur la page 2.

Le plugin demande une page de 24 résultats à la fois, puis extrait titre complet, auteurs, couverture, URL officielle et identifiant d’édition. Il utilise les liens de pagination de la source. Sans total exact dans la page, il présente un décompte approximatif lorsqu’une page suivante existe. Une page d’erreur ou un changement de structure ne devient pas un résultat vide trompeur.

La recherche porte sur le catalogue public anglophone. Elle reprend le moteur de mots-clés du site, qui peut trouver aussi des auteurs ou des descriptions : elle ne se limite pas strictement au titre. Sa [politique de collection](https://standardebooks.org/contribute/collections-policy) décrit le périmètre anglais, y compris les traductions vers l’anglais.

Les [flux officiels](https://standardebooks.org/feeds), notamment l’OPDS complet et les [téléchargements groupés](https://standardebooks.org/bulk-downloads), ont des conditions d’accès distinctes. L’audit initial avait observé HTTP 401 sur l’OPDS. Aucun identifiant ni endpoint de remplacement n’est utilisé pour contourner cette restriction. La recherche HTML publique rend cet accès inutile pour l’intégration actuelle.

## Téléchargement direct réellement vérifié

Les essais Chromium ont effectué de vraies requêtes depuis une page de l’origine `https://drslid.github.io`, sans modifier le User-Agent, sans cookies et sans identifiants. Seul le document de test initial était servi par interception Playwright ; les requêtes de recherche, de fiche et de téléchargement Standard Ebooks étaient réelles.

Le lien « Compatible epub » de la fiche peut renvoyer une page intitulée « Your Download Has Started! », contenant une redirection HTML officielle `meta refresh` vers le même fichier avec `?source=download`. Le plugin suit seulement ce lien exact, une fois. Il ne lance aucun script et n’accepte ni une autre origine, ni un autre EPUB, ni un écran de connexion à la place du fichier.

| Livre | EPUB reçu | Import réel dans FastReader |
| --- | --- | --- |
| [Pride and Prejudice, Jane Austen](https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice) | HTTP 200, `application/epub+zip`, signature ZIP, 831 959 octets | 65 chapitres, 122 675 mots, couverture JPEG embarquée ; livre retrouvé dans IndexedDB après rechargement |
| [Frankenstein, Mary Shelley](https://standardebooks.org/ebooks/mary-shelley/frankenstein) | EPUB valide de 685 797 octets | 38 chapitres, 78 594 mots, couverture embarquée |

La [configuration Apache officielle](https://github.com/standardebooks/web/blob/master/config/apache/standardebooks.org.conf) prévoit CORS sur les livres pour les lecteurs dans le navigateur. La validation repose ici sur les téléchargements réussis, pas uniquement sur cette configuration. Ces essais portent sur deux éditions : ils ne garantissent pas la compatibilité de chaque EPUB du catalogue.

Le [robots.txt](https://standardebooks.org/robots.txt) comporte des exclusions de téléchargement pour certains robots. L’intégration effectue le téléchargement demandé par le lecteur dans son navigateur ; elle n’aspire pas les EPUB ni le catalogue en arrière-plan.

## Couvertures, provenance et droits

Les miniatures officielles sont affichables par `<img>` ; leur téléchargement par `fetch` peut être bloqué par CORS. Le plugin ne télécharge pas les EPUB pour fabriquer des miniatures de recherche. Après import, la couverture intégrée à l’EPUB permet de conserver une image locale. Une comparaison visuelle de *Pride and Prejudice* a confirmé la même illustration, le même cadrage et le même bandeau de titre dans la miniature et dans l’EPUB.

Les identifiants `standardebooks:...` distinguent cette édition d’une autre édition Gutenberg du même texte. L’import conserve la source, la fiche, la notice de droits et l’archive originale avec ses crédits.

La [présentation du projet](https://standardebooks.org/) et chaque fiche expliquent que les textes et illustrations sont considérés libres aux États-Unis et que le travail éditorial original de Standard Ebooks est dédié au domaine public via CC0. Cela ne garantit pas le statut de chaque édition dans tous les pays. Les résultats renvoient à la fiche précise pour cette vérification ; la notice générale de FastReader ne se substitue pas aux conditions de l’édition.

## Recherche parallèle et confidentialité

Une recherche unifiée non vide inclut Standard Ebooks lorsque la langue sélectionnée est l’anglais ou toutes les langues. Ses résultats s’affichent dès qu’ils arrivent, indépendamment d’une autre source plus lente. L’ouverture de l’application seule ne déclenche pas de recherche distante. Le filtre explicite Standard Ebooks permet aussi de parcourir les nouveautés sans mot-clé.

Contrairement au catalogue Gutenberg hébergé localement, cette recherche transmet ses mots-clés au site Standard Ebooks. Les requêtes n’envoient ni cookies ni en-tête Referer. Les EPUB importés et la progression restent dans le stockage local de FastReader.

## Code et tests

- `src/sources/standard-ebooks.js` : plugin versionné, lecture du XHTML dans un document XML inerte, URLs limitées à l’édition officielle, annulation et limites de taille/durée.
- `tests/standard-ebooks.test.js` : 14 tests de recherche, pagination, titres longs, URLs, annulation, EPUB et redirection de téléchargement.
- `tests/federated-search.test.js` : recherches indépendantes, publication progressive, panne isolée, langue, pagination et annulation sans résultat périmé.
- `tests/e2e/source-catalogs.spec.js` : parcours navigateur de recherche jusqu’à la bibliothèque et reprise, avec réponses réseau déterministes.
- `tests/e2e/fixtures.js` : les tests automatiques ordinaires ne contactent pas réellement Standard Ebooks ou Ebooks libres et gratuits. Les preuves réseau réelles ci-dessus sont distinctes de ces fixtures.

La structure HTML publique peut évoluer ; ce plugin devra alors être mis à jour. Une erreur de source conserve les autres résultats et ne prétend jamais avoir téléchargé un EPUB lorsqu’il ne s’agit que de HTML.
