<?php
/**
 * Exemple de surcharge locale de configuration.
 *
 * Copier ce fichier en "inc_config_perso.php" (même répertoire) pour
 * personnaliser des valeurs sans modifier inc_config.php. Ce fichier copié
 * est ignoré par git : c'est le seul geste de configuration nécessaire pour
 * installer l'application.
 *
 * La fusion est récursive (array_replace_recursive) : on ne redéclare que les
 * clés que l'on veut changer, pas le tableau entier.
 */

$config_perso = [
    // En production, ne jamais laisser les erreurs détaillées visibles.
    'env'   => 'prod',
    'debug' => false,

    // Si l'application n'est pas servie à la racine du domaine mais dans un
    // sous-répertoire, indiquer le préfixe ici (sans slash final).
    // 'base_url' => '/sam',

    // Utiliser une autre instance Overpass (par exemple une instance
    // auto-hébergée, ou une instance miroir), ou allonger le cache.
    // 'overpass' => [
    //     'endpoints' => ['https://overpass.private.example/api/interpreter'],
    //     'cache_ttl' => 30 * 86400,
    // ],

    // Autre fournisseur de tuiles. Attention : vérifier ses conditions
    // d'utilisation et adapter l'attribution en conséquence.
    // 'tiles' => [
    //     'url'         => 'https://tuiles.example/{z}/{x}/{y}.png',
    //     'attribution' => 'Tuiles &copy; Example &mdash; données &copy; OpenStreetMap',
    // ],

    // Serrer ou desserrer les garde-fous du proxy selon la machine.
    // 'limites' => ['surface_max_km2' => 50],
];
