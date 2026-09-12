# Standard Ebooks : faisabilité d’une nouvelle source

Audit ciblé du 12 septembre 2026. **Aucun plugin activé, aucun catalogue aspiré, aucun contact envoyé.**

Standard Ebooks est un bon candidat pour des éditions anglaises soignées et des couvertures illustrées. Il ne remplace pas une source de livres en français : sa [politique de collection](https://standardebooks.org/contribute/collections-policy) exclut les livres non anglophones, tout en acceptant les traductions vers l’anglais.

## Accès au catalogue

La [documentation officielle des flux](https://standardebooks.org/feeds) distingue :

- le flux Atom des nouveautés, public ;
- les autres flux, notamment le catalogue OPDS complet, accessibles aux membres du Patrons Circle, contributeurs éligibles et sponsors ;
- un accès possible pour des projets open source, après échange avec Standard Ebooks et selon leurs critères.

Le format OPDS 2.0 existe via l’en-tête `Accept: application/opds+json`, mais cela ne dispense pas de l’autorisation d’accès. Les [téléchargements groupés](https://standardebooks.org/bulk-downloads) sont également un avantage des membres. Un relais ne doit pas transformer ces accès restreints en catalogue public sans accord.

**Choix envisageables après validation :** une petite sélection éditoriale contrôlée ou un snapshot du flux public des nouveautés ; pour une recherche exhaustive maintenable, obtenir l’accord d’intégration open source. Le flux public ne constitue pas une API de recherche de tout le fonds.

## Droits et couvertures

Standard Ebooks annonce que son travail éditorial original est dédié au domaine public via CC0 ; il indique que les textes et illustrations retenus sont considérés libres aux États-Unis. Cela ne garantit pas le statut de chaque édition dans tous les pays. La [présentation du projet](https://standardebooks.org/) et la [fiche de Pride and Prejudice](https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice) explicitent cette distinction.

Un import devra conserver la provenance, les crédits, la déclaration de droits et l’identifiant d’édition. Pour une copie intégrée au site, contrôler aussi traduction et illustration de couverture. Le pied de page distingue le contenu produit par Standard Ebooks du contenu tiers éventuellement affiché : ne pas appliquer CC0 indistinctement à toutes les images du site. L’autorisation de réutilisation d’une image et l’autorisation technique de la charger par JavaScript sont deux sujets distincts.

## Requêtes réellement effectuées

Requêtes HTTP limitées, sans cookies ni identifiants, avec `Origin: https://drslid.github.io`. Aucun nouvel essai après la réponse 401 du catalogue OPDS.

| Ressource officielle | Résultat observé | Conséquence |
| --- | --- | --- |
| `/feeds/atom/new-releases` | HTTP 200, `application/atom+xml`, 15 notices, aucun `Access-Control-Allow-Origin` | Snapshot possible depuis un outil de maintenance ; le navigateur ne peut pas lire directement le flux depuis Pages. |
| `/feeds/opds` | HTTP 401, défi HTTP Basic du Patrons Circle, `Access-Control-Allow-Origin: *` | Catalogue complet restreint ; CORS n’accorde aucun droit d’accès. |
| `/ebooks/jane-austen/pride-and-prejudice` | HTTP 200, XHTML, `Access-Control-Allow-Origin: *` | Fiche lisible par `fetch` depuis notre origine. Ce constat ne valide pas une API stable de recherche. |
| `/images/covers/jane-austen_pride-and-prejudice/495dd49502f1fd5609a27a16f5af2f0a387accb4/cover.jpg` | HTTP 200, JPEG de 25 316 octets, aucun `Access-Control-Allow-Origin` | Affichage `<img>` possible ; téléchargement par `fetch` bloqué pour cette URL. |

Le flux public contient les titres, auteurs, descriptions, sujets, droits, liens vers les fiches et liens d’acquisition avec leur type MIME et taille. Il propose notamment le format EPUB compatible ; il faut distinguer celui-ci de l’EPUB avancé, du fichier Kobo et de l’AZW3.

Un essai Chromium a confirmé les trois comportements CORS ci-dessus et l’affichage de la couverture en 242 × 363 pixels. Le document de test vide a été servi par interception Playwright à une URL de l’origine `https://drslid.github.io` ; **les requêtes Standard Ebooks étaient réelles, sans interception**. Ce test isole CORS : il ne valide ni le CSP final de FastReader, ni son import EPUB, ni la disponibilité hors ligne des couvertures.

## Téléchargement EPUB : limite de cette vérification

La fiche publique référence l’EPUB compatible :

`https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub`

La [configuration Apache publiée par Standard Ebooks](https://github.com/standardebooks/web/blob/master/config/apache/standardebooks.org.conf#L127) prévoit explicitement CORS pour `/ebooks` afin de permettre les lecteurs dans le navigateur. **C’est un indice favorable, pas un essai réussi du fichier EPUB.**

Le [robots.txt consulté](https://standardebooks.org/robots.txt) exclut les chemins `/ebooks/*/downloads/*` et `/ebooks/*/text*` pour plusieurs agents, dont `chatgpt-user`. Ces chemins n’ont pas été téléchargés par cet audit. Aucun changement d’identité, miroir ou contournement n’a servi à tester l’EPUB. Il reste donc à valider le téléchargement autorisé d’un EPUB réel et son ouverture dans FastReader avant d’annoncer « Lire » fonctionnel pour cette source.

## Intégration proposée

Après accord sur la source et son périmètre, utiliser un plugin statiquement déclaré avec des identifiants d’éditions Standard Ebooks, sans fusion automatique avec une édition Gutenberg distincte. La recherche locale utiliserait un snapshot autorisé ; elle n’enverrait pas les recherches des lecteurs à Standard Ebooks.

Prévoir la couverture réellement conservée avant/après import, la reprise d’une copie déjà présente et un message honnête en cas d’échec. Tester l’import compatible, les notes, le sommaire, les crédits, les longues descriptions et le fonctionnement hors ligne. Ne pas activer un relais par défaut : les observations sur `/ebooks` laissent envisager un téléchargement direct depuis Pages, qui demande encore la validation réelle décrite ci-dessus.

**Recommandation :** retenir Standard Ebooks pour enrichir l’offre anglaise ; commencer par définir une sélection limitée ou demander l’accès open source au catalogue complet. Ne pas annoncer aujourd’hui une recherche exhaustive gratuite sans compte et une ouverture EPUB vérifiée.
