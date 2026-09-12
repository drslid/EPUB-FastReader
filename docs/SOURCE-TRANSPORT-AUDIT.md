# Autres essais de recherche et de téléchargement

Essais limités du 12 septembre 2026, sans activation d’un plugin. Le critère est le parcours complet dans FastReader sur GitHub Pages : trouver une édition, récupérer son EPUB et l’importer. Un catalogue accessible ou un téléchargement réussi côté serveur ne suffit pas.

| Candidat | Recherche / catalogue réellement essayé | EPUB / conséquence |
| --- | --- | --- |
| Wolne Lektury | API officielle, fiche de *Studnia i wahadło* d’Edgar Allan Poe : HTTP 200, JSON et CORS `*`. La documentation expose les œuvres, auteurs et filtres. | EPUB officiel : HTTP 200, 226 612 octets et signature ZIP, mais pas d’en-tête CORS. L’accès direct depuis Pages n’est donc pas validé ; aucun import FastReader essayé dans cet audit. |
| Open Book Publishers via Thoth | Véritable recherche GraphQL `books(limit:3, filter:"Behavioral Economics")`, POST depuis Chromium à l’origine Pages : HTTP 200, titres, auteurs, licences et liens de formats disponibles. | Le résultat *Is Behavioral Economics Doomed?* possède un lien EPUB officiel ; sa récupération et celle de sa couverture échouent explicitement par CORS dans Chromium. Source non retenue pour une intégration directe. |
| Office of the Historian | Catalogue OPDS officiel des nouveautés : HTTP 200 et liens EPUB. Aucun CORS dans la réponse. | La recherche et le fichier EPUB n’ont pas été testés de bout en bout ; cette seule réponse ne démontre pas une source utilisable directement. |
| Unglue.it | L’OPDS de recherche publique documenté `https://unglue.it/api/opds/epub/s.open/` n’a pas répondu dans les délais de 15 puis 20 secondes depuis cet environnement. | Aucun EPUB obtenu via ce parcours. Ce constat ponctuel ne prouve pas une panne générale. |

Le test Thoth utilise une page minimale servie par interception Playwright à l’origine `https://drslid.github.io`, sans modifier le site public. Les requêtes GraphQL, EPUB et couverture sont réelles, non interceptées. Il isole les autorisations du navigateur, sans simuler un téléchargement réussi.

Pour Thoth, `GET /graphql` répond 405 en indiquant la méthode POST attendue ; le test a ensuite suivi cette méthode officielle, sans authentification. Le schéma public fournit les champs `titles`, `publications`, `locations`, `fullTextUrl`, `license` et `contributions`. La présence du type `EPUB` ne doit pas être confondue avec la disponibilité de son fichier, et une recherche Thoth ne doit pas afficher comme lisibles des notices ne proposant que du PDF.

Ressources officielles : [API Wolne Lektury](https://wolnelektury.pl/api/), [réutilisation Wolne Lektury](https://wolnelektury.pl/info/zasady-wykorzystania/), [documentation Thoth](https://thoth.pub/docs), [fiche du livre OBP essayé](https://www.openbookpublishers.com/books/10.11647/obp.0021), [API Office of the Historian](https://history.state.gov/developer/catalog), [API Unglue.it](https://unglue.it/api/help).

Pour les pistes littéraires et les alternatives à un relais, voir [Wikisource](SOURCE-WIKISOURCE-AUDIT.md), [Bibebook / BEQ](SOURCE-BROWSER-CANDIDATES.md), [Gallica / ELG](SOURCE-ALTERNATIVES-AUDIT.md), [Standard Ebooks](SOURCE-STANDARDEBOOKS-AUDIT.md) et [Internet Archive / OAPEN](SOURCE-ARCHIVE-OAPEN-AUDIT.md). Les droits des éditions, crédits et conditions de redistribution restent propres à chaque source ; le problème CORS et l’autorisation de réhéberger sont deux vérifications distinctes.
