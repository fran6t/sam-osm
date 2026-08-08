<?php
/**
 * Configuration de l'application SAM.
 *
 * Ce fichier définit la configuration par défaut ($config) valable pour un
 * clone neuf du dépôt. Pour surcharger des valeurs sur une installation
 * particulière (autre instance Overpass, autre base d'URL...), copier
 * inc_config_perso.example.php vers inc_config_perso.php (fichier ignoré par
 * git) : il sera fusionné par-dessus ce fichier, sans avoir à le modifier.
 *
 * Règle importante (§9 du cahier de conception) : aucune URL de fournisseur
 * de données ou de tuiles ne doit être écrite ailleurs que dans ce fichier.
 * Changer d'instance Overpass ou de fournisseur de tuiles ne doit jamais
 * demander de toucher au moteur de calcul.
 */

$config = [
    'env'   => 'dev',   // 'dev' ou 'prod'
    'debug' => true,    // affiche les erreurs détaillées si true

    // Racine du dépôt sur le disque (pas de chemin absolu codé en dur)
    'base_path' => dirname(__DIR__),

    // Base de l'URL de l'appli. Vide car l'application est servie à la racine
    // du domaine (https://sam.ratchou.fr/). Mettre par exemple '/sam' si elle
    // est installée dans un sous-répertoire : ce préfixe conditionne les liens
    // vers assets/ (fonction asset()).
    'base_url' => '',

    'app_name' => 'SAM',
    'lang'     => 'fr',

    // Base SQLite. Elle ne sert qu'à un seul usage en V1 : mettre en cache les
    // réponses Overpass (§10 du cahier). Aucune donnée personnelle, aucun
    // compte utilisateur. Le fichier est créé automatiquement au besoin.
    // 'driver' est prévu pour accueillir plus tard 'mysql' sans changer la
    // forme de la configuration.
    'db' => [
        'driver' => 'sqlite',
        'path'   => dirname(__DIR__) . '/bddsam/cache.sqlite',
    ],

    // Fournisseur de données OSM interrogé par le proxy PHP (api/).
    // Les serveurs publics Overpass sont une ressource partagée : ils ne sont
    // ni garantis ni illimités. Le cache et les limites ci-dessous existent
    // pour rester un bon citoyen (§9 du cahier).
    'overpass' => [
        'endpoints' => [
            'https://overpass-api.de/api/interpreter',
        ],
        'timeout'   => 30,        // secondes, timeout d'une requête sortante
        'cache_ttl' => 7 * 86400, // secondes, durée de validité d'une réponse en cache
    ],

    // Fournisseur de tuiles pour Leaflet. L'attribution est une obligation,
    // pas une option : elle doit rester affichée sur la carte.
    'tiles' => [
        'url'         => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        'attribution' => '&copy; les contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        'max_zoom'    => 19,
    ],

    // Vue au premier chargement de la carte (centre de la France, vue large).
    'carte' => [
        'centre' => [46.6, 2.4],
        'zoom'   => 6,
    ],

    // Paramètres du moteur de calcul, transmis tels quels au Web Worker.
    // Le §6 du cahier l'exige : aucune de ces valeurs ne doit être codée en
    // dur dans le moteur, elles se règlent ici.
    'calcul' => [
        // Côté d'une cellule de l'index spatial, en mètres. Trop petit, la
        // grille pèse en mémoire ; trop grand, elle ne filtre plus rien.
        'taille_cellule' => 250,

        'optimisation' => [
            'passes'         => [100, 20, 5], // pas de balayage successifs, en mètres
            'rayon_initial'  => 2000,         // rayon exploré par la passe grossière, en mètres
            'nb_alternatives' => 3,           // maxima locaux proposés (§6 du cahier)
            'separation_min' => 400,          // écart minimal entre deux alternatives, en mètres
        ],
    ],

    // Jeu d'obstacles fictifs de la V0 : à graine égale, mêmes obstacles.
    // Disparaîtra avec l'arrivée des vraies données OSM.
    'graine_demo' => 42,

    // Garde-fous appliqués par le proxy à toute requête venant du navigateur
    // (§16 du cahier). Le client peut proposer n'importe quoi : c'est ici que
    // l'on décide ce qui est acceptable.
    'limites' => [
        'surface_max_km2' => 100, // surface maximale de la zone dessinée
        'sommets_max'     => 200, // nombre maximal de sommets du polygone
        'reponse_max_mo'  => 20,  // taille maximale d'une réponse Overpass acceptée
    ],
];

// Surcharge locale optionnelle (non versionnée)
$persoFile = __DIR__ . '/inc_config_perso.php';
if (file_exists($persoFile)) {
    require $persoFile; // doit définir $config_perso = [...]
    if (isset($config_perso) && is_array($config_perso)) {
        $config = array_replace_recursive($config, $config_perso);
    }
}
