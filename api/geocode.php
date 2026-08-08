<?php
/**
 * geocode.php — convertit un code postal en coordonnées.
 *
 * Rôle    : permettre d'ouvrir la carte directement au bon endroit, sans
 *           charger les tuiles du pays entier en attendant que l'utilisateur
 *           navigue jusqu'à son secteur.
 * Entrées : GET ?cp=<code postal>
 * Sorties : JSON { lat, lon, nom }  ou  { erreur }
 * Dépend  : api/_lib.php, un service de géocodage (Nominatim par défaut).
 *
 * Le fournisseur et ses réglages sont dans inc/inc_config.php : ce fichier ne
 * connaît aucune URL en dur, et n'accepte aucune URL du navigateur.
 */

require __DIR__ . '/_lib.php';

$config = config()['geocodage'];

// ------------------------------------------------------------------
// Validation de l'entrée : tout ce qui vient du client est suspect.
// ------------------------------------------------------------------
$codePostal = trim($_GET['cp'] ?? '');

if ($codePostal === '') {
    repondreErreur('Indiquez un code postal.');
}

// Le motif dépend du pays visé et se règle dans la configuration : un code
// postal français fait 5 chiffres, un britannique n'a pas cette forme.
if (!preg_match($config['motif'], $codePostal)) {
    repondreErreur('Code postal invalide pour le pays configuré (' . e($config['pays']) . ').');
}

// ------------------------------------------------------------------
// Cache : un code postal ne se déplace pas. Une fois résolu, il n'y a
// aucune raison de redemander au fournisseur avant longtemps.
// ------------------------------------------------------------------
$cle = 'geocode:' . $config['pays'] . ':' . $codePostal;

$enCache = cacheLire($cle);
if ($enCache !== null) {
    repondreJson(json_decode($enCache, true) + ['cache' => true]);
}

// ------------------------------------------------------------------
// Appel du fournisseur
// ------------------------------------------------------------------
$url = $config['endpoint'] . '?' . http_build_query([
    'postalcode' => $codePostal,
    'country'    => $config['pays'],
    'format'     => 'jsonv2',
    'limit'      => 1,
]);

try {
    respecterCadence('geocodage', $config['intervalle_min']);
    $reponse = appelerFournisseur($url, $config['timeout'], $config['reponse_max_octets']);
} catch (RuntimeException $e) {
    repondreErreur('Service de géolocalisation indisponible : ' . $e->getMessage(), 502);
}

$resultats = json_decode($reponse, true);
if (!is_array($resultats) || count($resultats) === 0) {
    repondreErreur('Code postal introuvable.', 404);
}

$premier = $resultats[0];
if (!isset($premier['lat'], $premier['lon'])) {
    repondreErreur('Réponse inattendue du service de géolocalisation.', 502);
}

$resultat = [
    'lat' => (float) $premier['lat'],
    'lon' => (float) $premier['lon'],
    'nom' => $premier['display_name'] ?? $codePostal,
];

cacheEcrire($cle, json_encode($resultat, JSON_UNESCAPED_UNICODE), $config['cache_ttl']);

repondreJson($resultat + ['cache' => false]);
