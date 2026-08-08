# SAM — Seul Au Monde / Somewhere Away from Mankind

Recherche cartographique d'un point éloigné des traces de présence humaine OSM (bivouac, affût
photo). Dépôt destiné à être **public** (GitHub), licence MIT.

**Avant toute décision de conception, lire `doc/CAHIER_CONCEPTION_ISOLEMENT_OSM.md`** : il fait
autorité (workflow, algorithme, format interne, licences, étapes V0→V1.1). Ne pas le paraphraser
ici. Ce fichier ne contient que ce qui ne s'en déduit pas.

État : socle nu. `index.php`, `api/`, `src/` restent à écrire (V0 : Leaflet + polygone + clic +
obstacles fictifs + optimisation locale, **avant** toute complexité OSM).

## Arborescence

```
index.php   page carte          api/     proxy PHP → Overpass + cache
inc/        config + helpers    src/     moteur JS (géométrie, index spatial, normalisation)
assets/     css js fonts vendor/ (Leaflet & co, vendorés)
bddsam/     cache.sqlite (non versionné, .htaccess Require all denied)
```

`inc/inc_lib.php` (~95 lignes) expose **tout** le PHP partagé : `config()`, `e()`, `asset()`,
`checkRequirements()`, `checkPermissions()`. Ne pas le grepper pour autre chose, il n'y a rien
d'autre.

## Règles dures

- **Pas de composer, pas de npm, pas de build, pas de framework.** Installation = copier les
  fichiers + copier `inc_config_perso.example.php`. Une dépendance ne s'ajoute qu'après avoir
  justifié qu'une implémentation locale courte ne suffit pas (§15 du cahier), et se vendore dans
  `assets/vendor/`, jamais un CDN.
- **Calculs dans le navigateur**, dans un Web Worker. Le serveur ne fait aucune géométrie.
- **Aucune URL de fournisseur hors de `inc/inc_config.php`** (clés `overpass`, `tiles`). Changer
  d'instance Overpass ne doit toucher aucun autre fichier.
- **Le moteur ignore OSM.** `src/` reçoit des obstacles normalisés
  (`{points:[], lines:[], polygons:[]}`) et ne connaît aucun tag OSM ; la traduction se fait dans
  la couche de normalisation, seule à connaître les tags.
- **Pas de session, pas de compte, pas de cookie, pas de tracking, aucun upload.** Zone dessinée,
  point cliqué et corrections manuelles restent côté navigateur. Si un POST apparaît un jour, on
  réintroduira CSRF (retiré à dessein : il imposait un cookie de session).
- **Le proxy ne relaie jamais une URL fournie par le client.** Fournisseur choisi côté serveur ;
  valider polygone, surface, nombre de sommets, taille de réponse et timeout d'après
  `config()['limites']`. Jamais de proxy HTTP ouvert.
- **Distances en mètres, jamais lat/lon traités comme des mètres.** Projection locale documentée
  dans le code. Distance à la **géométrie réelle** (segment, bord de polygone), pas au centroïde.
- **Rien de codé en dur dans le moteur** : pas des 100/20/5 m, tout paramétrable.
- **Attribution OSM visible** sur la carte + rappel ODbL. Ne pas redistribuer de données dérivées
  sans réexaminer l'ODbL.
- **Dépôt public** : aucune donnée réelle, aucun secret, aucun chemin absolu de la machine, pas de
  `phpinfo()`. Le dépôt vient d'une copie de TruckGED — si un identifiant `truckged|adminerft|
  dataft|bddft|dompdf|chauffeur|ordre` réapparaît quelque part, c'est une régression.

## Style de code

Le cahier (§14) fait du code **pédagogique** un livrable, pas un bonus. Fonctions courtes, noms
français cohérents avec l'existant, un commentaire d'en-tête par module (rôle / entrées / sorties /
dépendances). Commenter le **pourquoi** : hypothèses géométriques, unités, transformations de
coordonnées, limites, compromis de perf, bizarreries OSM. Pas de commentaire qui répète le code.
Préférer la solution qu'un développeur PHP/JS classique comprend en lisant le fichier.

## Le score est plafonné par la limite de connaissance

Hors de la zone chargée, aucun obstacle n'est connu : sans précaution le score y grimpe
artificiellement et l'optimiseur colle ses résultats contre la frontière (constaté en V0, les trois
maxima étaient sur le bord). `calculerScore()` dans `src/optimizer.js` borne donc le score par la
distance au contour passé en `options.bordConnaissance` — on ne certifie un isolement que jusqu'à
la limite de ce qu'on a examiné, et le cercle ne déborde jamais de la zone. Le bord apparaît alors
parmi les éléments limitants, ce qui se lit « élargissez la zone », pas « c'est isolé ».

**En V1**, `bordConnaissance` doit devenir l'emprise élargie sur laquelle les données OSM ont été
chargées (marge ≥ `rayonInitial`), et non la zone dessinée — sinon on plafonne plus tôt que
nécessaire. `estDansZone` reste, lui, la zone dessinée.

## Commandes

```sh
php -S localhost:8000        # serveur de dev (racine du dépôt)
php -l <fichier>             # lint après toute édition PHP
node src/tests.js            # 39 vérifications du moteur géométrique, sans dépendance
```

`src/tests.js` compare notamment l'index spatial à un balayage exhaustif : toute optimisation de
`spatial-index.js` doit le laisser vert. Commits en français, impératif, une étape logique par commit.
