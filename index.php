<?php
/**
 * Page unique de SAM : la carte et son panneau de pilotage.
 *
 * Le PHP se contente de servir la page et d'y injecter la configuration
 * (fournisseur de tuiles, limites, paramètres de calcul). Tout le reste se
 * passe dans le navigateur : le serveur ne fait aucune géométrie.
 *
 * V0 : les obstacles sont FICTIFS, générés dans la zone dessinée. L'objectif
 * est de valider l'algorithme d'isolement avant d'ajouter Overpass (§20 du
 * cahier de conception).
 */
require __DIR__ . '/inc/inc_lib.php';

$config = config();

// Configuration destinée au JavaScript. On ne recopie que ce dont la page a
// besoin : ni chemins disque, ni détails serveur.
$configJs = [
    'vueInitiale'  => $config['carte']['centre'],
    'zoomInitial'  => $config['carte']['zoom'],
    'tuiles'       => [
        'url'         => $config['tiles']['url'],
        'maxZoom'     => $config['tiles']['max_zoom'],
        'attribution' => $config['tiles']['attribution'],
    ],
    'limites'      => [
        'surfaceMaxKm2' => $config['limites']['surface_max_km2'],
        'sommetsMax'    => $config['limites']['sommets_max'],
    ],
    'calcul'       => [
        'tailleCellule' => $config['calcul']['taille_cellule'],
        'optimisation'  => [
            'passes'         => $config['calcul']['optimisation']['passes'],
            'rayonInitial'   => $config['calcul']['optimisation']['rayon_initial'],
            'nbAlternatives' => $config['calcul']['optimisation']['nb_alternatives'],
            'separationMin'  => $config['calcul']['optimisation']['separation_min'],
        ],
    ],
    'graineDemo'   => $config['graine_demo'],
    'cheminWorker' => rtrim($config['base_url'], '/') . '/src/worker.js',
];
?>
<!DOCTYPE html>
<html lang="<?= e($config['lang']) ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($config['app_name']) ?> &mdash; Seul Au Monde</title>
    <meta name="description" content="Trouver un emplacement éloigné des traces de présence humaine connues d'OpenStreetMap.">
    <link rel="stylesheet" href="<?= e(asset('css/bootstrap.min.css')) ?>">
    <link rel="stylesheet" href="<?= e(asset('vendor/leaflet/leaflet.css')) ?>">
    <link rel="stylesheet" href="<?= e(asset('css/app.css')) ?>">
</head>
<body>

<div class="sam-application">

    <aside class="sam-panneau">
        <header class="mb-3">
            <h1 class="h4 mb-0"><?= e($config['app_name']) ?></h1>
            <p class="text-muted small mb-0">Seul Au Monde &mdash; <i>Somewhere Away from Mankind</i></p>
        </header>

        <div class="alert alert-secondary py-2 px-3 small" role="note">
            <strong>Version 0 &mdash; obstacles fictifs.</strong>
            Les obstacles sont générés aléatoirement dans la zone que vous dessinez.
            Ils ne viennent pas d'OpenStreetMap : cette version sert à valider le calcul.
        </div>

        <div id="message" class="alert alert-light border py-2 px-3 mb-3"></div>

        <ol class="sam-etapes">
            <li>
                Délimiter une zone
                <div class="mt-1">
                    <button type="button" class="btn btn-sm btn-primary" id="btnZone">Placer le rectangle</button>
                </div>
                <div class="form-text">Étirez les poignées des coins pour l'ajuster.</div>
            </li>
            <li>
                Charger les obstacles
                <div class="mt-1">
                    <button type="button" class="btn btn-sm btn-primary" id="btnObstacles" disabled>Générer (fictifs)</button>
                </div>
            </li>
            <li>
                Cliquer un point approximatif
                <div class="mt-1">
                    <button type="button" class="btn btn-sm btn-primary" id="btnPoint" disabled>Choisir le point</button>
                </div>
            </li>
            <li>
                Optimiser
                <div class="mt-1">
                    <button type="button" class="btn btn-sm btn-success" id="btnOptimiser" disabled>Lancer le calcul</button>
                </div>
            </li>
        </ol>

        <div id="resultats"></div>

        <details class="mt-3 small">
            <summary class="text-muted">Légende</summary>
            <ul class="list-unstyled mt-2 mb-0">
                <li><span class="sam-puce" style="background:#dc3545"></span> route</li>
                <li><span class="sam-puce" style="background:#fd7e14"></span> chemin</li>
                <li><span class="sam-puce" style="background:#6f42c1"></span> bâtiment</li>
                <li><span class="sam-puce" style="background:#20c997"></span> infrastructure ponctuelle</li>
                <li><span class="sam-puce" style="background:#198754"></span> meilleur résultat &amp; cercle d'isolement</li>
            </ul>
        </details>

        <footer class="sam-avertissement small text-muted mt-3">
            <p class="mb-1">
                Le résultat ne garantit ni l'absence de personnes, ni l'absence de propriété privée,
                ni l'autorisation de bivouaquer, ni l'accès légal, ni la sécurité. SAM mesure
                seulement un isolement d'après les données et les critères disponibles, qui sont
                incomplets.
            </p>
            <p class="mb-0">
                Fond de carte &copy; les contributeurs
                <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &mdash;
                <a href="https://github.com/fran6t/sam-osm">code source</a> (MIT).
            </p>
        </footer>
    </aside>

    <main id="carte" class="sam-carte"></main>
</div>

<script>window.SAM = <?= json_encode($configJs, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;</script>
<script src="<?= e(asset('vendor/leaflet/leaflet.js')) ?>"></script>
<script src="<?= e(rtrim($config['base_url'], '/')) ?>/src/geometry.js"></script>
<script src="<?= e(rtrim($config['base_url'], '/')) ?>/src/obstacles-demo.js"></script>
<script src="<?= e(asset('js/app.js')) ?>"></script>
</body>
</html>
