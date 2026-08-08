# Cahier de conception --- Projet « Isolement OSM »

## 1. Objet du projet

Créer une application web libre et open source permettant à un
utilisateur de rechercher et d'affiner un emplacement géographiquement
éloigné des traces de présence humaine connues.

Le cas d'usage initial est la préparation de bivouacs et d'affûts
photographiques, mais l'outil doit rester générique.

L'application doit privilégier : - la simplicité technique ; - la
transparence des calculs ; - un code pédagogique, lisible et abondamment
commenté ; - le calcul côté navigateur afin de limiter la charge serveur
; - le respect des licences et politiques d'utilisation d'OpenStreetMap
; - le partage maximal du code, sans restriction propre au projet
au-delà des obligations imposées par les données, services ou
bibliothèques tierces.

J'ai retenu SAM comme non du projet, car il peut -etre francophone pour Seul Au Monde,
mais aussi SAM pour Somewhere Away from Mankind

Il sera surement en service à l'url https://sam.ratchou.fr je pourrais jouer sur le fait qu'un ratchou 
si il est loin de tout seul au monde ça match bien avec ratchou 


## 2. Philosophie

Le projet n'a pas vocation à être une grosse plateforme.

Éviter autant que possible : - frameworks PHP ; - frameworks JavaScript
; - Composer ; - npm ; - bundlers ; - chaînes de compilation ; - Docker
comme prérequis ; - dépendances complexes ou inutiles.

Le projet doit idéalement pouvoir être installé ainsi :

1.  copier les fichiers sur un hébergement PHP classique ;
2.  renseigner un petit fichier de configuration ;
3.  ouvrir le site.

Le code doit pouvoir être compris par une personne connaissant PHP,
JavaScript, HTML et CSS sans devoir apprendre une architecture complexe.

## 3. Stack retenue

### Serveur

-   PHP 8+ natif, sans framework.
-   SQLite en priorité.
-   MariaDB n'est pas nécessaire pour la V1 mais pourra rester une
    possibilité future.
-   Le serveur ne réalise pas les calculs géométriques lourds.

Rôles principaux de PHP : - servir l'application ; - fournir un proxy
contrôlé vers les fournisseurs de données OSM / Overpass ; - mettre en
cache les réponses utiles ; - appliquer des limites raisonnables aux
requêtes ; - permettre de changer de fournisseur sans modifier le moteur
client.

### Client

-   HTML5.
-   CSS.
-   Bootstrap, utilisé de façon classique et sans chaîne de build.
-   JavaScript natif (« vanilla JS »).
-   Leaflet pour la carte.
-   Un seul plugin Leaflet de dessin, par exemple Leaflet-Geoman ou
    Leaflet.draw, après comparaison.
-   Web Worker natif pour les calculs géométriques.

Ne pas ajouter Turf.js ou une autre grosse bibliothèque géométrique tant
qu'elle n'est pas réellement nécessaire.

Les primitives géométriques simples pourront être écrites dans le projet
: - distance point-point ; - distance point-segment ; - distance
point-polyligne ; - test point dans polygone ; - bounding boxes ; -
index spatial simple.

## 4. Workflow utilisateur principal

### Étape 1 --- Choix de la zone

Afficher une carte.

L'utilisateur dessine à la souris un polygone représentant la zone qu'il
souhaite étudier.

La taille maximale de la zone devra être contrôlée afin d'éviter des
requêtes excessives vers les services externes.

### Étape 2 --- Identification automatique

Récupérer les éléments OpenStreetMap pouvant représenter une présence ou
une infrastructure humaine.

Exemples à étudier : - routes ; - pistes ; - chemins ; - sentiers ; -
bâtiments ; - parkings ; - voies ferrées ; - certains objets `man_made`
; - éventuellement lignes/infrastructures électriques ; - éventuellement
barrières et autres objets pertinents.

IMPORTANT : ne pas réduire ces éléments à de simples points.

Conserver autant que possible leur géométrie : - route / chemin = ligne
ou polyligne ; - bâtiment = polygone ; - infrastructure ponctuelle =
point.

Les catégories exactes et les tags OSM retenus doivent être
configurables et documentés.

### Étape 3 --- Inspection humaine

Afficher clairement les objets détectés sur la carte.

L'utilisateur inspecte le secteur et peut compléter les données
manquantes en ajoutant manuellement des repères/obstacles.

Ces corrections manuelles doivent rester locales par défaut.

Ne jamais considérer les données OSM comme exhaustives.

### Étape 4 --- Point approximatif choisi par l'utilisateur

Le mode principal n'est pas nécessairement une recherche automatique sur
toute la zone.

L'utilisateur possède souvent déjà une intuition grâce au relief, à la
végétation, à l'accès ou à son objectif photographique.

Il clique donc approximativement à l'endroit qui lui paraît intéressant.

### Étape 5 --- Optimisation locale

À partir du point choisi, l'algorithme recherche le maximum local
d'isolement.

Pour une position candidate P :

    score(P) = min(distance(P, obstacle_i))

Le meilleur point est celui qui maximise ce score dans le voisinage
choisi.

Intuitivement, le programme déplace le point jusqu'à le placer au centre
du plus grand espace libre local possible.

Le résultat doit afficher : - le point optimisé ; - la distance à
l'obstacle le plus proche ; - l'obstacle limitant ; - idéalement les
quelques obstacles les plus proches ; - un cercle centré sur le résultat
dont le rayon correspond à la distance minimale.

### Étape 6 --- Alternatives

Si possible, présenter plusieurs maxima locaux intéressants plutôt qu'un
seul.

Exemple : - A : 1 420 m ; - B : 1 365 m ; - C : 1 310 m.

L'utilisateur reste décisionnaire : le meilleur résultat mathématique
n'est pas nécessairement le meilleur emplacement réel pour un bivouac ou
un affût.

## 5. Mode secondaire : recherche globale

Prévoir à terme deux modes :

1.  **Optimiser depuis mon point** --- mode principal.
2.  **Chercher dans toute la zone** --- recherche des points les plus
    isolés dans tout le polygone.

La V1 peut privilégier le premier mode s'il simplifie fortement le
développement.

## 6. Algorithme et performances

Le calcul doit être effectué dans le navigateur.

Utiliser un Web Worker afin que la carte et l'interface restent
réactives pendant le calcul.

Éviter l'approche naïve consistant à comparer chaque point candidat à
tous les objets.

Première approche souhaitée : - index spatial simple par grille («
spatial hashing ») ; - chaque cellule référence les géométries
susceptibles de l'affecter ; - recherche multi-résolution.

Exemple d'optimisation locale : 1. recherche grossière autour du clic ;
2. conservation de la meilleure position ; 3. réduction du rayon ; 4.
réduction du pas ; 5. répétition jusqu'à la précision voulue.

Valeurs indicatives uniquement : - passe grossière : pas 100 m ; - passe
intermédiaire : pas 20 m ; - passe fine : pas 5 m.

Ne pas coder ces valeurs en dur dans le moteur : elles doivent être
paramétrables.

Le moteur doit être indépendant d'OpenStreetMap.

Il reçoit des géométries normalisées et calcule des distances.

## 7. Format interne

Créer une couche de normalisation entre les données OSM et le moteur.

Conceptuellement :

    Fournisseur OSM
          ↓
      normalisation
          ↓
    obstacles internes
          ↓
    moteur géométrique

Format interne minimal envisageable :

    {
        "points": [],
        "lines": [],
        "polygons": []
    }

Chaque obstacle peut aussi posséder : - un identifiant ; - une catégorie
; - sa source ; - les métadonnées utiles ; - un état actif/inactif.

Le moteur de calcul ne doit pas dépendre des tags OSM.

## 8. Architecture suggérée

Structure indicative, à adapter sans sur-ingénierie :

    /public
        index.php
        app.js
        app.css
        worker.js

        /vendor
            /leaflet
            /bootstrap
            /leaflet-draw-ou-geoman

    /api
        osm.php
        config.php

    /src
        geometry.js
        spatial-index.js
        osm-normalizer.js

    /data
        cache.sqlite

Le découpage doit rester pragmatique. Ne pas créer des dizaines de
classes ou fichiers pour des abstractions qui n'apportent rien.

## 9. Accès aux données OpenStreetMap

Distinguer impérativement :

1.  la licence des données OpenStreetMap ;
2.  les conditions d'utilisation des serveurs publics OSM et Overpass.

Les données OSM sont utilisables sous ODbL avec les obligations
d'attribution et autres obligations applicables.

Les serveurs publics OSM/Overpass sont des ressources partagées et ne
doivent jamais être considérés comme un backend gratuit sans limites.

Prévoir une abstraction de fournisseur dès le départ.

Conceptuellement :

    Application
       ├── MapProvider
       └── OSMDataProvider

L'objectif est de pouvoir : - changer d'instance Overpass ; - changer de
fournisseur de tuiles ; - ajouter un proxy/cache ; - auto-héberger des
données plus tard ; - utiliser un fournisseur tiers si nécessaire ;

sans réécrire le moteur de l'application.

Ne pas disperser les URL de fournisseurs dans le code.

## 10. Proxy PHP et cache

Même si les calculs restent côté client, privilégier un petit proxy PHP
pour les requêtes de données.

Il permettra : - validation des requêtes ; - limitation de la surface
maximale ; - limitation des abus ; - timeout ; - cache ; - changement
d'instance Overpass ; - éventuellement rotation/fallback contrôlé entre
fournisseurs autorisés.

SQLite peut servir uniquement de cache en V1.

Le cache pourra contenir : - clé/hash de requête ; - zone ou paramètres
; - date ; - réponse ; - expiration.

Ne pas stocker de données personnelles sans nécessité.

## 11. Vie privée

Principe : minimisation maximale.

La sélection de zone, le point approximatif, les corrections manuelles
et les résultats doivent rester côté navigateur autant que possible.

Pas de compte utilisateur en V1.

Pas de tracking nécessaire au fonctionnement.

Pas de stockage serveur des recherches individuelles sauf nécessité
technique clairement documentée.

## 12. Partage et licence du projet

Intention du projet : **partage total**.

Le code source doit être publié librement et être facilement
réutilisable, modifiable, redistribuable et auto-hébergeable.

Le projet lui-même ne souhaite imposer aucune restriction artificielle
d'usage.

Choisir une licence open source très permissive, probablement **MIT** ou
**0BSD**, après vérification finale des implications.

IMPORTANT : - la licence du code du projet ne remplace pas la licence
ODbL des données OpenStreetMap ; - conserver les attributions OSM
requises ; - respecter les licences des bibliothèques tierces ; -
documenter ces licences dans le dépôt ; - ne jamais présenter les
serveurs OSM comme faisant partie des ressources fournies ou garanties
par le projet.

Si des données dérivées OSM sont un jour redistribuées, réexaminer
précisément les obligations ODbL avant publication.

## 13. Données ajoutées manuellement

Les repères manuels sont destinés en premier lieu au calcul local de
l'utilisateur.

Attention aux sources propriétaires.

Ne pas construire une base publique en recopiant des informations depuis
Google Maps, Google Satellite ou d'autres sources dont les conditions ne
permettent pas cette réutilisation.

Une fonctionnalité future de partage des corrections nécessitera une
réflexion spécifique sur : - provenance des données ; - droits de
réutilisation ; - licence ; - modération ; - contribution éventuelle
directement à OpenStreetMap.

Pour la V1 : corrections manuelles locales et temporaires.

## 14. Qualité du code --- exigence importante pour Codex

Le code doit être **pédagogique**.

Priorités : 1. lisibilité ; 2. simplicité ; 3. commentaires expliquant
le raisonnement ; 4. fonctions courtes et bien nommées ; 5. absence de
magie ; 6. facilité de débogage ; 7. performance suffisante ; 8.
sophistication seulement si elle devient nécessaire.

Les commentaires doivent surtout expliquer : - pourquoi un choix est
fait ; - les hypothèses géométriques ; - les unités utilisées ; - les
transformations de coordonnées ; - les limitations ; - les compromis de
performance ; - les particularités des données OSM.

Éviter les commentaires inutiles qui répètent simplement le code.

Chaque module important doit commencer par un court commentaire
expliquant : - son rôle ; - ses entrées ; - ses sorties ; - ses
dépendances.

Les fonctions géométriques importantes doivent disposer d'exemples ou de
tests simples.

## 15. Dépendances

Règle générale :

> Une dépendance n'est ajoutée que si elle apporte une valeur nettement
> supérieure au coût de compréhension, maintenance et déploiement.

Dépendances actuellement acceptées : - Bootstrap ; - Leaflet ; - un
plugin de dessin Leaflet.

Avant toute nouvelle dépendance : 1. expliquer le problème qu'elle
résout ; 2. vérifier qu'une petite implémentation locale n'est pas plus
raisonnable ; 3. vérifier sa licence ; 4. éviter toute dépendance
imposant npm/Composer/build si ce n'est pas indispensable.

Les bibliothèques pourront être stockées localement dans `/vendor`
plutôt que dépendre obligatoirement d'un CDN.

## 16. Sécurité et robustesse

Le proxy PHP doit considérer toutes les données venant du navigateur
comme non fiables.

Prévoir notamment : - validation du polygone ; - limite de
taille/surface ; - limite de complexité/nombre de sommets ; - timeout
; - taille maximale des réponses ; - aucune URL externe arbitraire
fournie par l'utilisateur au proxy ; - fournisseur défini côté serveur
; - messages d'erreur compréhensibles.

Ne jamais transformer le proxy en proxy HTTP ouvert.

## 17. Exactitude géographique

Les distances affichées doivent être en mètres.

Pour les petites zones, une projection locale adaptée ou une
approximation documentée pourra être utilisée pour accélérer les
calculs.

Ne pas utiliser naïvement latitude/longitude comme coordonnées
cartésiennes en mètres.

Documenter précisément la méthode retenue.

L'algorithme doit calculer la distance aux géométries réelles : -
segment de route ; - bord/surface pertinente d'un bâtiment ; - point
manuel ; et non simplement au centre de chaque objet.

## 18. Interface

L'interface doit rester simple.

Workflow visible :

    1. Délimiter une zone
    2. Charger les données
    3. Inspecter / compléter
    4. Cliquer approximativement
    5. Optimiser
    6. Examiner le résultat

Prévoir des interrupteurs pour activer/désactiver des catégories : -
routes ; - pistes ; - chemins ; - sentiers ; - bâtiments ; - parkings
; - autres infrastructures ; - repères manuels.

Afficher clairement ce qui est pris en compte dans le calcul.

## 19. Avertissements fonctionnels

Le résultat n'est pas une garantie : - d'absence de personnes ; -
d'absence de propriété privée ; - d'autorisation de bivouac ; - d'accès
légal ; - de sécurité ; - d'exhaustivité des données ; - de pertinence
écologique ou photographique.

L'application mesure uniquement l'isolement selon les données et
critères disponibles.

Prévoir un message discret mais clair dans l'interface.

## 20. Développement par étapes

### V0 --- preuve de concept

-   Leaflet ;
-   carte ;
-   dessin d'un polygone ;
-   clic d'un point ;
-   quelques obstacles fictifs ;
-   optimisation locale dans le navigateur ;
-   cercle d'isolement.

Objectif : valider l'algorithme avant toute complexité OSM.

### V1 --- données OSM

-   proxy PHP ;
-   Overpass ;
-   normalisation ;
-   routes/chemins/bâtiments ;
-   affichage des obstacles ;
-   corrections manuelles ;
-   Web Worker ;
-   cache SQLite.

### V1.1 --- ergonomie

-   filtres par catégorie ;
-   plusieurs maxima locaux ;
-   détails de l'obstacle limitant ;
-   export/import local éventuel.

### Plus tard

-   recherche globale ;
-   autres fournisseurs ;
-   données auto-hébergées ;
-   partage volontaire d'analyses ;
-   PWA/offline uniquement avec une source de tuiles/données qui
    l'autorise ;
-   amélioration de l'index spatial si les mesures montrent que cela est
    nécessaire.

## 21. Consigne générale à l'agent IA

Ne pas sur-concevoir.

Avant d'introduire une abstraction, une bibliothèque ou une architecture
complexe, demander :

> Est-ce nécessaire pour la version actuelle et est-ce que cela rend
> réellement le projet plus simple à comprendre ou maintenir ?

Commencer par une implémentation minimale fonctionnelle.

Faire des commits/étapes logiques.

Ne jamais sacrifier la lisibilité pour une optimisation hypothétique.

Lorsque plusieurs solutions sont possibles, privilégier celle qu'un
développeur PHP/JavaScript classique peut comprendre en lisant
directement les fichiers.

Conserver dans le README les instructions d'installation, les choix
techniques, les limites OSM et les obligations d'attribution/licence.
