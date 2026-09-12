# Sources EPUB complémentaires : audit Gallica et Ebooks libres et gratuits

Vérification du 12 septembre 2026. Ces sources sont **candidates à une validation commune**, pas des plugins activés. Le contrôle ne porte que sur les endpoints et les éditions indiqués ; il ne garantit ni la disponibilité permanente ni les droits de tout le catalogue. Wikisource et Standard Ebooks font l'objet d'audits séparés.

**Précision après le nouveau critère utilisateur :** si la condition est une recherche et une récupération EPUB directement utilisables dans FastReader sur GitHub Pages sans relais, **aucune des deux sources ci-dessous n'est retenue**. Le classement documente seulement les possibilités techniques avec un relais futur ; il ne constitue plus une proposition d'activation immédiate. Les essais complémentaires Bibebook et BEQ sont dans [SOURCE-BROWSER-CANDIDATES.md](SOURCE-BROWSER-CANDIDATES.md).

## Décision proposée

| Rang entre les deux sources examinées | Apport | Condition avant intégration |
| --- | --- | --- |
| 1. Gallica, sélection EPUB | Catalogue institutionnel français, vrai contrat OPDS/SRU, identifiants ARK, images et EPUB complets. | Relais hébergé, sélection d'éditions lisibles, attribution BnF et application des conditions de réutilisation. |
| 2. Ebooks libres et gratuits, sélection d'éditions | Littérature française et traductions, véritable recherche OPDS, fichiers complets préparés pour la lecture. | Relais, respect strict des limites du serveur, revue des droits **par édition**, y compris les éditions partenaires. |

L'ordre reflète la facilité de maintenir une intégration documentée. Pour la lecture courante, une édition corrigée d'Ebooks libres et gratuits peut être préférable à une édition ancienne OCR de Gallica. Aucune de ces deux sources ne résout seule le téléchargement JavaScript depuis GitHub Pages : les réponses HTTP examinées n'autorisent pas CORS.

## Gallica

La BnF documente explicitement un catalogue `https://gallica.bnf.fr/opds` et une recherche `services/engine/search/opds`, au protocole SRU. Le filtre `dc.formatspecific all "epub"` permet de demander des EPUB au lieu de mélanger fac-similés, PDF et livres lisibles. Les notices annoncent l'acquisition EPUB, une miniature, une image et la fiche source. La [documentation officielle OPDS](https://api.bnf.fr/fr/api-opds-du-catalogue-de-livres-numeriques-de-gallica) explique cette utilisation.

Recherche réellement exécutée : `dc.title all "Candide" and dc.formatspecific all "epub"`, avec `filter=provenance all "bnf.fr"` et cinq notices maximum. Elle répond avec trois notices : deux éditions de Voltaire, plus un résultat moins pertinent, *Foulque de Candie*. Il faut donc conserver notre classement de pertinence et l'identité de l'édition, plutôt que fusionner tous les résultats au seul titre.

Le fichier [Candide, édition 1759, ARK bpt6k1057560q](https://gallica.bnf.fr/ark:/12148/bpt6k1057560q.epub) a été téléchargé et ouvert avec le véritable `importEpub` du projet dans JSDOM : **35 sections, 29 823 mots et une couverture**. L'archive ZIP passe le contrôle CRC et possède le bon mimetype. Ces sections comprennent les éléments liminaires ; ce n'est pas une affirmation de 35 chapitres narratifs. Le code de langue fourni est `fre`, à normaliser vers `fr` dans un futur adaptateur. Le sommaire est exploitable ; l'extrait examiné conserve orthographe ancienne et quelques erreurs OCR. La recherche OPDS retourne actuellement des liens `http://` qu'il faudra convertir en HTTPS uniquement pour l'hôte officiel autorisé.

Les [conditions BnF](https://www.bnf.fr/fr/portail-bnf-api-et-jeux-de-donnees) distinguent les métadonnées sous Licence ouverte et les reproductions : réutilisation non commerciale gratuite avec mention de la source, réutilisation commerciale soumise à licence. L'EPUB conserve une notice de provenance et les conditions de Gallica. Le futur plugin doit garder ces mentions et ne pas présenter toute reproduction comme CC0. Les ressources de partenaires peuvent avoir d'autres conditions.

## Ebooks libres et gratuits

Le [site officiel](https://www.ebooksgratuits.com/) publie et recommande son OPDS aux applications de lecture. Le descripteur [OpenSearch](https://www.ebooksgratuits.com/opds/opensearch.xml) fournit la requête `opds/feed.php?mode=search&query={searchTerms}`. Le catalogue *Candide* testé expose auteur, titre, fiche, relation d'acquisition EPUB et autres formats, sans image de couverture dans cette notice. Une couverture typographique locale reste donc nécessaire avant import ; il ne faut pas télécharger tous les EPUB pour construire une grille de résultats.

La [notice d'utilisation](https://www.ebooksgratuits.com/notice_util.php) limite le téléchargement à 50 livres par personne et par jour et demande des téléchargements successifs. Elle avertit notamment qu'une rafale de plus de cinq par minute peut provoquer un bannissement IP. Un relais commun ne doit pas traiter cela comme un quota indépendant par utilisateur : cache, file d'attente et capacité partagée doivent être définis avant activation. Le `robots.txt` annonce également un délai de dix secondes et exclut le chemin du gestionnaire de téléchargement du crawl ; cet audit suit seulement quelques liens d'acquisition explicitement proposés par l'OPDS, sans aspiration du site.

La [note sur les droits](https://www.ebooksgratuits.com/droitaut.php) précise que le catalogue international n'est pas intégralement libre dans le pays de chaque lecteur. La page d'accueil inclut une réserve non commerciale et un traitement particulier des auteurs contemporains. La fiche de l'édition et les contributeurs, traducteurs ou illustrateurs doivent donc être vérifiés ; l'absence d'un champ `dc:rights` ne vaut pas autorisation.

Le [Candide de la notice 637](https://www.ebooksgratuits.com/details.php?book=637) est en réalité une édition partenaire de la Bibliothèque numérique romande, 2015. Après une redirection 302 interne, l'acquisition fournit `epub/voltaire_candide.epub` : archive CRC valide, import FastReader réussi, **38 sections, 31 930 mots et couverture**. Son colophon mentionne une utilisation du livre sans modification et des restrictions commerciales/professionnelles sur les ajouts éditoriaux. Il faut éclaircir la compatibilité de cette édition avec l'export EPUB Focus avant de la proposer automatiquement ; la présence de l'œuvre de Voltaire dans le domaine public ne règle pas les conditions de cette édition complète. Les premières sections de cet exemple reçoivent des titres génériques dans le lecteur actuel, autre point à corriger pour une intégration de qualité.

## Mesures HTTP et navigateur

Les requêtes HTTP ont envoyé `Origin: https://drslid.github.io`. La vérification Chromium a effectué de vrais `fetch` sans identifiants depuis une page de test de cette origine. Seule cette page de test était fournie par Playwright ; les réponses des sources n'étaient pas simulées.

| Ressource | HTTP réel | `Access-Control-Allow-Origin` | Chromium depuis l'origine Pages |
| --- | --- | --- | --- |
| ELG racine OPDS / descripteur OpenSearch | 200 XML | absent | Non rejoué |
| ELG recherche Candide | 200 XML, une notice | absent | Refus CORS explicite |
| ELG Candide EPUB final | 200 `application/epub+zip`, 1 530 924 octets | absent | Refus CORS explicite |
| Gallica racine OPDS | 200 XML | absent | Non rejoué |
| Gallica recherche Candide | 200 XML, trois notices | absent | Refus CORS explicite |
| Gallica Candide EPUB | 200 `application/epub+zip`, 698 394 octets | absent | Délai dépassé après 25 s lors du second essai |
| Gallica miniature de ce Candide | Délai dépassé après 25 s | Non déterminé | Non rejoué |

La réponse HTTP réussie de l'EPUB Gallica démontre la disponibilité du fichier au premier essai, mais le nouvel essai navigateur a expiré avant de pouvoir établir son propre diagnostic CORS. Un futur adaptateur doit gérer ces lenteurs et conserver une couverture de repli. Un lien ou une image externe affichable ne prouve pas qu'un `fetch` permet d'importer le fichier dans IndexedDB.

Empreintes SHA-256 des EPUB contrôlés :

- ELG Candide : `6af1ac942a90cd7a01c47829727c82b26b94c4f77a99ec4cccddee12b09ae4c0`.
- Gallica Candide : `62d3891e34bcd4a528bf81f76a1f23872a17127da7170bdb34c2a79a00477b8f`.

## Public Domain Library

Le site reste intéressant pour une sélection visuelle, mais les pages [À propos](https://publicdomainlibrary.org/en/about), [colophon](https://publicdomainlibrary.org/en/colophon) et [conditions](https://publicdomainlibrary.org/en/terms-and-conditions) consultées n'établissent pas de contrat d'API/OPDS ni de licence détaillée des couvertures et contributions récentes. Sa page de conditions affiche essentiellement un texte de confidentialité. Cela ne prouve pas qu'aucun accord soit possible ; ce n'est pas une base assez claire pour développer et maintenir une ingestion automatique. Conserver le lien existant et clarifier ces points avec l'organisme avant un adaptateur.

## Travail à préparer après choix commun

Un premier lot de quelques éditions permettrait de contrôler droits, couvertures, intégralité et sommaire avant d'élargir le catalogue. L'adaptateur devrait maintenir un identifiant source stable, un lien vers les conditions, les contributions de l'édition, les capacités réellement disponibles et les limites réseau. Pour le mode distant, le relais doit accepter des identifiants contrôlés, suivre seulement les redirections autorisées de la source choisie, limiter les tailles et respecter ses quotas. Aucun proxy public, domaine alternatif ou contournement anti-bot n'a été utilisé ou proposé.
