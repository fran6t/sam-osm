/**
 * obstacles-demo.js — générateur d'obstacles FICTIFS pour la V0.
 *
 * Rôle    : fabriquer un jeu d'obstacles plausible à l'intérieur de la zone
 *           dessinée, afin de valider l'algorithme d'isolement sans dépendre
 *           d'OpenStreetMap (§20 du cahier : « valider l'algorithme avant
 *           toute complexité OSM »).
 * Entrées : le polygone de la zone, en [lat, lon].
 * Sorties : des obstacles au format interne (§7 du cahier), donc exactement
 *           ce que produira plus tard la normalisation OSM. Le moteur ne verra
 *           aucune différence : c'est tout l'intérêt de la couche de
 *           normalisation.
 * Dépend  : rien.
 *
 * CE FICHIER DISPARAÎTRA (ou deviendra un mode « démo ») en V1, quand les
 * vraies données arriveront via api/ et osm-normalizer.js.
 */

/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 *
 * POURQUOI pas Math.random() : à graine égale, on veut le MÊME jeu
 * d'obstacles d'une exécution à l'autre. Sans cela, impossible de comparer
 * deux réglages de l'optimiseur, ni de reproduire un comportement surprenant.
 */
function creerAleatoire(graine) {
    var etat = graine >>> 0;
    return function () {
        etat = (etat + 0x6d2b79f5) >>> 0;
        var t = etat;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Fabrique un jeu d'obstacles fictifs couvrant la zone.
 *
 * La DENSITÉ compte autant que la forme : un jeu trop clairsemé donne des
 * résultats qui paraissent arbitraires, parce que le moindre vide devient un
 * maximum. On vise donc un ordre de grandeur réaliste pour de la campagne
 * française — un réseau de voies tous les kilomètre environ, des hameaux
 * groupés, des fermes isolées — et l'on fait croître les quantités avec la
 * surface, pour que le rendu soit comparable quelle que soit la taille de la
 * zone dessinée.
 *
 * @param {Array} zone   polygone [[lat, lon], ...]
 * @param {number} graine
 * @returns {Array} obstacles au format interne
 */
function genererObstaclesFictifs(zone, graine) {
    var hasard = creerAleatoire(graine === undefined ? 42 : graine);

    var latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
    zone.forEach(function (p) {
        latMin = Math.min(latMin, p[0]);
        latMax = Math.max(latMax, p[0]);
        lonMin = Math.min(lonMin, p[1]);
        lonMax = Math.max(lonMax, p[1]);
    });

    var hauteur = latMax - latMin;
    var largeur = lonMax - lonMin;

    // Dimensions approximatives en kilomètres, pour raisonner en densité.
    // Approximation volontairement grossière : elle ne sert qu'à choisir des
    // quantités, pas à mesurer quoi que ce soit.
    var latMoyenne = (latMin + latMax) / 2;
    var hauteurKm = hauteur * 111.2;
    var largeurKm = largeur * 111.2 * Math.cos(latMoyenne * Math.PI / 180);
    var surfaceKm2 = Math.max(hauteurKm * largeurKm, 0.01);

    var obstacles = [];
    var compteur = 0;

    function identifiant(prefixe) {
        compteur += 1;
        return prefixe + '-' + compteur;
    }

    function pointAleatoire() {
        return [latMin + hasard() * hauteur, lonMin + hasard() * largeur];
    }

    /** Nombre d'éléments pour une densité donnée, avec un minimum de 1. */
    function combien(parKm2) {
        return Math.max(1, Math.round(surfaceKm2 * parKm2));
    }

    // --- Voies : un réseau lâche, environ une voie par kilomètre dans chaque
    // direction. Chaque voie traverse la zone en zigzaguant légèrement, comme
    // une route qui suit un relief.
    function ajouterVoie(horizontale, position, categorie, libelle) {
        var sommets = [];
        var nbSommets = 6 + Math.floor(hasard() * 5);
        var derive = position;

        for (var s = 0; s < nbSommets; s++) {
            var avance = s / (nbSommets - 1);
            derive += (hasard() - 0.5) * 0.08; // sinuosité
            derive = Math.min(0.98, Math.max(0.02, derive));

            sommets.push(
                horizontale
                    ? [latMin + derive * hauteur, lonMin + avance * largeur]
                    : [latMin + avance * hauteur, lonMin + derive * largeur]
            );
        }

        obstacles.push({
            id: identifiant(categorie),
            type: 'ligne',
            categorie: categorie,
            libelle: libelle,
            source: 'demo',
            actif: true,
            coords: sommets,
        });
    }

    var nbVoiesHorizontales = Math.max(1, Math.round(hauteurKm / 1.5));
    var nbVoiesVerticales = Math.max(1, Math.round(largeurKm / 1.5));

    for (var vh = 0; vh < nbVoiesHorizontales; vh++) {
        var routePrincipale = vh === 0;
        ajouterVoie(true, (vh + 0.5) / nbVoiesHorizontales,
            routePrincipale ? 'route' : 'chemin',
            routePrincipale ? 'Route départementale (fictive)' : 'Chemin rural (fictif)');
    }
    for (var vv = 0; vv < nbVoiesVerticales; vv++) {
        ajouterVoie(false, (vv + 0.5) / nbVoiesVerticales,
            vv % 2 === 0 ? 'chemin' : 'route',
            vv % 2 === 0 ? 'Chemin forestier (fictif)' : 'Route communale (fictive)');
    }

    // --- Bâtiments : de petits quadrilatères, soit groupés en hameaux, soit
    // isolés (fermes, granges). Le groupement compte : c'est lui qui crée les
    // grandes poches vides entre les zones habitées.
    function ajouterBatiment(centre, tailleM) {
        var dLat = (tailleM / 2) / 111200;
        var dLon = dLat / Math.max(0.2, Math.cos(latMoyenne * Math.PI / 180));

        obstacles.push({
            id: identifiant('batiment'),
            type: 'polygone',
            categorie: 'batiment',
            libelle: 'Bâtiment (fictif)',
            source: 'demo',
            actif: true,
            coords: [
                [centre[0] - dLat, centre[1] - dLon],
                [centre[0] - dLat, centre[1] + dLon],
                [centre[0] + dLat, centre[1] + dLon],
                [centre[0] + dLat, centre[1] - dLon],
            ],
        });
    }

    var nbHameaux = combien(0.4);
    for (var h = 0; h < nbHameaux; h++) {
        var centreHameau = pointAleatoire();
        var nbMaisons = 5 + Math.floor(hasard() * 12);

        for (var m = 0; m < nbMaisons; m++) {
            // Dispersion d'environ 150 m autour du centre du hameau.
            ajouterBatiment([
                centreHameau[0] + (hasard() - 0.5) * 300 / 111200,
                centreHameau[1] + (hasard() - 0.5) * 300 / (111200 * Math.cos(latMoyenne * Math.PI / 180)),
            ], 8 + hasard() * 14);
        }
    }

    var nbFermes = combien(0.8);
    for (var f = 0; f < nbFermes; f++) {
        ajouterBatiment(pointAleatoire(), 12 + hasard() * 20);
    }

    // --- Objets ponctuels : pylônes, antennes, abris, silos...
    var nbPoints = combien(1.5);
    for (var p = 0; p < nbPoints; p++) {
        obstacles.push({
            id: identifiant('point'),
            type: 'point',
            categorie: 'infrastructure',
            libelle: 'Infrastructure ponctuelle (fictive)',
            source: 'demo',
            actif: true,
            coords: [pointAleatoire()],
        });
    }

    return obstacles;
}
