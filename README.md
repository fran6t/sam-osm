# SAM

**SAM** — *Seul Au Monde*, ou *Somewhere Away from Mankind*.

Application web libre permettant de rechercher, sur une carte, un emplacement
géographiquement éloigné des traces de présence humaine connues d'OpenStreetMap.

Le cas d'usage d'origine est la préparation de bivouacs et d'affûts
photographiques, mais l'outil reste générique : il mesure une distance à des
obstacles, rien de plus.

> ⚠️ **SAM ne garantit rien** : ni l'absence de personnes, ni l'absence de
> propriété privée, ni l'autorisation de bivouaquer, ni l'accès légal, ni la
> sécurité, ni l'exhaustivité des données. Les données OpenStreetMap sont
> incomplètes par nature. L'application mesure uniquement un isolement d'après
> les données disponibles et les critères choisis.

## État du projet

🚧 Démarrage. Le dépôt contient pour l'instant le cahier de conception et le
socle technique. Voir [`doc/CAHIER_CONCEPTION_ISOLEMENT_OSM.md`](doc/CAHIER_CONCEPTION_ISOLEMENT_OSM.md)
pour la conception détaillée et les étapes prévues (V0 → V1 → V1.1).

## Installation

Prérequis : **PHP 8.0+** avec l'extension **`pdo_sqlite`**. Pas de Composer,
pas de npm, pas de build, pas de Docker.

1. Copier les fichiers du dépôt sur un hébergement PHP classique.
2. Copier `inc/inc_config_perso.example.php` en `inc/inc_config_perso.php` et
   y ajuster ce qui doit l'être (au minimum `env` et `debug` en production).
3. S'assurer que le dossier `bddsam/` est accessible en écriture par le
   serveur web : le cache SQLite y est créé automatiquement.
4. Ouvrir le site.

En développement :

```sh
php -S localhost:8000
```

## Choix techniques

- **PHP 8 natif, sans framework.** Le serveur ne fait que servir les pages et
  jouer le rôle de proxy contrôlé vers Overpass.
- **Les calculs se font dans le navigateur**, en JavaScript natif, dans un Web
  Worker, pour ne pas charger le serveur et garder l'interface réactive.
- **SQLite uniquement comme cache** des réponses Overpass. Aucun compte
  utilisateur, aucune donnée personnelle stockée.
- **Vanilla JS + Leaflet + Bootstrap**, sans chaîne de compilation. Les
  bibliothèques sont stockées localement dans `assets/`, pas chargées depuis
  un CDN.
- Le code est écrit pour être lu : fonctions courtes, commentaires expliquant
  les choix, les unités et les hypothèses géométriques.

### Arborescence

```
index.php      page principale (carte)
assets/        css, js, polices et bibliothèques tierces (vendor/)
inc/           configuration et fonctions utilitaires PHP
api/           proxy PHP vers Overpass + cache
src/           moteur JavaScript (géométrie, index spatial, normalisation OSM)
bddsam/        cache SQLite (non versionné)
doc/           cahier de conception
```

## Données OpenStreetMap

Les données affichées et utilisées pour les calculs proviennent
d'**OpenStreetMap**, sous licence
[ODbL](https://www.openstreetmap.org/copyright). L'attribution
« © les contributeurs OpenStreetMap » doit rester visible sur la carte.

Deux choses à ne pas confondre :

- la **licence des données** (ODbL), qui autorise leur réutilisation sous
  conditions ;
- les **conditions d'utilisation des serveurs publics** OSM et Overpass, qui
  sont des ressources partagées, financées par des dons, et ne constituent pas
  un backend gratuit et illimité.

SAM interroge donc Overpass à travers un proxy qui limite la surface des
requêtes, applique un timeout et met les réponses en cache. Ces serveurs ne
font pas partie des ressources fournies ou garanties par ce projet, et
l'instance interrogée est configurable dans `inc/inc_config.php`.

## Licence

Code sous licence **MIT** (voir [`LICENSE`](LICENSE)) : réutilisation,
modification, redistribution et auto-hébergement libres.

Cette licence ne couvre ni les données OpenStreetMap (ODbL), ni les
bibliothèques tierces incluses, qui conservent leurs propres licences.
