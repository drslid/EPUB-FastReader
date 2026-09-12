# Sources françaises accessibles directement depuis le navigateur

Audit du 12 septembre 2026, après précision utilisateur : retenir uniquement une source permettant **recherche réelle et récupération d'un EPUB lisible dans FastReader**, sans renvoyer vers une simple fiche externe. Le scénario recherché ici est GitHub Pages sans relais hébergé.

**Résultat : aucun accès distant natif retenu parmi Bibebook et la Bibliothèque électronique du Québec.** Leurs fichiers existent et sont importables, mais le navigateur refuse les requêtes intersites. **Bibebook reste une piste de distribution autorisée sur notre propre hébergement**, distincte de cet accès distant : voir ci-dessous. L'ancien endpoint OPDS Atramenta testé ne fonctionne plus. Aucun plugin ni aucune source n'a été activé.

| Candidat | Recherche/catalogue vérifié | EPUB vérifié | Verdict GitHub Pages sans relais |
| --- | --- | --- | --- |
| Bibebook | JSON officiel de 1 722 notices, recherche auteur/titre utilisée par le site | Candide, 325 038 octets, import FastReader réussi | **Échec : catalogue et EPUB bloqués par CORS** |
| BEQ | Index HTML par auteurs, pas de contrat API/OPDS découvert dans les pages examinées | Le Comte de Chanteleine, 103 350 octets, import FastReader réussi | **Échec : page auteur et EPUB bloqués par CORS** |
| Atramenta, vérification limitée | Ancien `/opds/catalog.atom` | Non essayé : catalogue indisponible | **Échec : HTTP 404 sur le catalogue** |

## Bibebook : catalogue disponible, accès navigateur bloqué

Le [site officiel Bibebook](https://www.bibebook.com/) est actuellement disponible. Il charge [books.json](https://www.bibebook.com/books.json), puis effectue une recherche locale dans le titre et l'auteur. Il ne faut donc pas conclure à sa disparition à partir d'anciennes annonces de fermeture. Le JSON téléchargé contient 1 722 notices et 688 647 octets, avec identifiant de chemin, titre, auteur et liens HTML/PDF/EPUB. Il ne fournit ni langue ni licence détaillée ni couverture par notice. Il s'agit du fichier utilisé par leur site, sans contrat d'API versionné identifié.

L'[EPUB Candide](https://www.bibebook.com/voltaire-candide_ou_loptimisme/voltaire-candide_ou_loptimisme.epub) est une archive ZIP dont les CRC sont valides. Le véritable `importEpub` de FastReader, exécuté dans JSDOM, renvoie Voltaire, langue `fr`, 35 sections et 31 565 mots. Aucune couverture n'est reconnue par le parseur pour ce fichier. Une page de crédits incorporée déclare l'édition sous CC-BY-SA ; cela devra être conservé et précisé par édition si une distribution locale est envisagée. Cette piste de redistribution n'a pas été mise en œuvre et ne remplace pas un résultat positif au test CORS.

### Possibilité de miroir autorisé, sans relais

Le [texte officiel de cette édition](https://www.bibebook.com/voltaire-candide_ou_loptimisme/index.html), dans sa section finale de licence, **autorise expressément copie et redistribution** sous CC-BY-SA. L'EPUB possède la même mention. C'est donc une base concrète pour servir au moins cette édition depuis notre propre domaine, en conservant attributions et licence. Une sélection d'EPUB redistribuables, avec catalogue local, permettrait recherche et ouverture immédiate sur GitHub Pages sans dépendre du CORS Bibebook. Ce n'est pas un contournement du contrôle d'accès : la copie serait distribuée en vertu de la permission publiée.

En revanche, aucun **pack officiel actuel** ni taille globale vérifiable n'a été trouvé sur l'accueil ou dans le catalogue JSON. L'ancienne page officielle [download](https://www.bibebook.com/download) répond HTTP 404, tout comme `sitemap.xml`. Le JSON ne comporte aucune taille par fichier. L'audit n'a téléchargé qu'un EPUB Bibebook et n'a lancé ni téléchargement ni série de 1 722 requêtes HEAD. **On ne peut donc pas confirmer que l'ensemble tient dans 300–600 Mio**, ni étendre la licence de cet exemple à tous les fichiers sans les contrôler. Une petite sélection vérifiée reste concrètement envisageable ; un miroir de l'intégralité nécessite de retrouver un paquet officiel et de revoir les droits par édition ou d'obtenir les modalités du fournisseur.

### Preuve locale de recherche, lecture et bibliothèque : réussie pour un livre

Un serveur HTTP **strictement statique**, sans route API ni relais, a servi le build Pages existant sous `/EPUB-FastReader/`, le JSON officiel déjà récupéré et le seul EPUB Candide déjà contrôlé. Rien n'a été ajouté aux livres de production.

Dans Chromium avec une fenêtre mobile 390 × 844, le script de preuve a chargé le JSON réel par `fetch`, cherché « candide » parmi les 1 722 notices et obtenu une correspondance : Voltaire. La liste de livres effectivement disponibles était limitée à **cette seule édition**. Il a ensuite chargé l'EPUB depuis la même origine et créé un `File`, transmis au véritable gestionnaire d'import de l'application inchangée. Ce raccordement est celui du script de preuve ; aucun plugin Bibebook intégré à l'interface n'est encore livré.

Le lecteur s'est ouvert avec le titre attendu. IndexedDB contenait les 325 038 octets originaux, avec empreinte SHA-256 identique, les 35 sections et les 31 565 mots. La carte était visible dans **Ma bibliothèque**, puis encore présente après rechargement de la page, avec les mêmes données. Une seule récupération de l'EPUB, zéro appel `/api/` et zéro erreur JavaScript ont été relevés. Les service workers étaient désactivés dans ce contexte isolé ; ce contrôle valide le parcours statique et la persistance locale, pas le mode hors connexion.

**Conclusion de cette preuve :** la distribution autorisée d'une sélection Bibebook sur notre propre hébergement permet bien une recherche et une lecture réelles sans relais. **Elle ne démontre pas la disponibilité de 1 722 livres à lire**, seulement la recherche dans leurs métadonnées et l'import complet d'une édition disponible.

## BEQ : vrais livres, métadonnées et contrat machine insuffisants ici

La [Bibliothèque électronique du Québec](https://beq.ebooksgratuits.com/) propose plusieurs collections et formats. La [page Jules Verne](https://beq.ebooksgratuits.com/vents/verne.htm) contient de véritables liens d'acquisition EPUB. Elle est un index HTML ancien, pas un flux OPDS ou une réponse de recherche JSON. Un catalogue local nécessiterait donc un travail de structuration et de contrôle supplémentaire.

L'[EPUB Le Comte de Chanteleine](https://beq.ebooksgratuits.com/vents-epub/Verne-Chanteleine.epub) passe le contrôle CRC et l'import du projet : 20 sections et 32 749 mots, langue `fr`. L'auteur n'est pas renseigné de manière reconnue dans le fichier, et aucune couverture n'est reconnue. Les notices de provenance seraient donc nécessaires pour présenter correctement Jules Verne. L'annonce générale de domaine public sur l'accueil ne suffit pas à valider toute édition, traduction ou collection contemporaine.

## Tests réellement exécutés

Les quatre URL détaillées ci-dessus ont été demandées en HTTP avec `Origin: https://drslid.github.io`. Elles répondent **HTTP 200**, chacune sans `Access-Control-Allow-Origin`.

Un second contrôle Chromium a fait de vrais `fetch` avec `credentials: "omit"`, depuis une page de test d'origine `https://drslid.github.io`. Le catalogue Bibebook, la page Verne de BEQ et chacun des deux EPUB ont tous échoué avec un message explicite de refus CORS pour absence de cet en-tête. Les réponses distantes n'étaient pas simulées ; seule la page neutre portant l'origine était fournie par Playwright. Aucun proxy ni domaine de contournement n'a été utilisé.

Ces résultats distinguent deux propriétés : un EPUB peut se télécharger par navigation et s'importer manuellement, tout en restant inaccessible au `fetch` nécessaire à l'ouverture directe et à son ajout dans IndexedDB. Ce sont donc des **échecs au critère produit demandé**, malgré la présence de livres complets.

Empreintes des fichiers contrôlés :

- Bibebook Candide : `52ccc28bbcc539f6ed42ee2ae608b11a5cde67442ccc431d4777973d7bd124bf`.
- BEQ Le Comte de Chanteleine : `b21a6b0cd6070654c80c01d09b5acfbadccef5c85f4a4f7f2980964d521e9ee1`.
