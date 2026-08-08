/**
 * app.js — interface de SAM (thread principal).
 *
 * Rôle    : la carte, le dessin de la zone, le choix du point, l'affichage des
 *           résultats. Aucun calcul géométrique ici : tout part au Web Worker.
 * Entrées : window.SAM (configuration injectée par index.php).
 * Sorties : des couches Leaflet et du texte dans le panneau latéral.
 * Dépend  : Leaflet, src/worker.js, src/obstacles-demo.js, src/geometry.js
 *           (pour la mesure de surface, côté page).
 *
 * La page suit le déroulé du §18 du cahier : délimiter → charger → cliquer →
 * optimiser → examiner. Chaque étape n'active la suivante qu'une fois faite.
 */

(function () {
    'use strict';

    var config = window.SAM;

    // Une erreur JavaScript non rattrapée laisserait la page muette : la carte
    // s'affiche, mais plus aucun bouton ne répond, sans rien dire à personne.
    // On l'affiche donc dans le panneau, où l'utilisateur la voit vraiment.
    window.addEventListener('error', function (e) {
        var zone = document.getElementById('message');
        if (zone) {
            zone.className = 'alert alert-danger py-2 px-3 mb-3';
            zone.textContent = 'Erreur JavaScript : ' + e.message
                + ' (' + (e.filename || '?').split('/').pop() + ':' + e.lineno + ')';
        }
    });

    // ------------------------------------------------------------------
    // État de l'application. Volontairement plat et lisible : quatre données
    // suffisent à décrire où l'on en est.
    // ------------------------------------------------------------------
    var etat = {
        mode: null,        // 'zone' | 'point' | null : ce qu'un clic sur la carte déclenche
        zone: [],          // sommets de la zone, en [lat, lon]
        obstacles: [],     // format interne (§7 du cahier)
        depart: null,      // point approximatif choisi, en [lat, lon]
    };

    var couches = {
        zone: null,
        zoneEnCours: null,
        obstacles: L.layerGroup(),
        depart: null,
        resultats: L.layerGroup(),
    };

    // ------------------------------------------------------------------
    // Carte
    // ------------------------------------------------------------------
    var carte = L.map('carte', { doubleClickZoom: false }).setView(config.vueInitiale, config.zoomInitial);

    L.tileLayer(config.tuiles.url, {
        maxZoom: config.tuiles.maxZoom,
        attribution: config.tuiles.attribution,
    }).addTo(carte);

    couches.obstacles.addTo(carte);
    couches.resultats.addTo(carte);

    // ------------------------------------------------------------------
    // Web Worker
    // ------------------------------------------------------------------
    // Créé dans un try/catch : si le worker ne démarre pas (fichier introuvable,
    // page ouverte en file://, navigateur restrictif), on veut le SAVOIR et
    // garder l'interface utilisable. Sans cette précaution, l'exception
    // interromprait le script avant le branchement des boutons, plus bas : la
    // carte s'afficherait et plus rien ne répondrait, sans le moindre message.
    var worker = null;
    try {
        worker = new Worker(config.cheminWorker);
    } catch (erreur) {
        signalerWorkerIndisponible(erreur.message);
    }

    function signalerWorkerIndisponible(detail) {
        informer('Le moteur de calcul n\'a pas pu démarrer (' + detail + '). '
            + 'Le dessin de la zone reste possible, mais pas l\'optimisation.', true);
    }

    if (worker) {
        worker.onmessage = function (evenement) {
            var m = evenement.data;

            if (m.type === 'pret') {
                informer('Obstacles indexés (' + m.nbObstacles + ' géométries, ' + m.dureeMs + ' ms). Cliquez maintenant un point de départ approximatif.');
                activer('btnPoint', true);
            } else if (m.type === 'resultat') {
                afficherResultats(m.resultats, m.dureeMs);
            } else if (m.type === 'erreur') {
                informer('Erreur de calcul : ' + m.message, true);
                activer('btnOptimiser', true);
            }
        };

        worker.onerror = function (e) {
            signalerWorkerIndisponible(e.message);
        };
    }

    // ------------------------------------------------------------------
    // Étape 1 — délimiter la zone
    // ------------------------------------------------------------------
    // Pas de plugin de dessin en V0 : le besoin se résume à « poser des
    // sommets et refermer », soit une trentaine de lignes. Un plugin
    // (Geoman, Leaflet.draw) sera pesé au moment où l'édition de sommets
    // deviendra utile — cf. §15 du cahier sur les dépendances.

    function demarrerDessinZone() {
        etat.mode = 'zone';
        etat.zone = [];
        etat.depart = null;
        viderCouche('zone');
        viderCouche('zoneEnCours');
        viderCouche('depart');
        couches.obstacles.clearLayers();
        couches.resultats.clearLayers();
        etat.obstacles = [];
        activer('btnObstacles', false);
        activer('btnPoint', false);
        activer('btnOptimiser', false);
        document.getElementById('resultats').innerHTML = '';
        informer('Cliquez les sommets de la zone à étudier. Double-cliquez, ou utilisez « Terminer », pour la refermer. '
            + 'La carte est verrouillée pendant le dessin : utilisez la molette pour zoomer.');
        majBoutonsZone();
        appliquerMode();
    }

    function ajouterSommet(latlng) {
        if (etat.zone.length >= config.limites.sommetsMax) {
            informer('Nombre maximal de sommets atteint (' + config.limites.sommetsMax + ').', true);
            return;
        }
        etat.zone.push([latlng.lat, latlng.lng]);
        redessinerZoneEnCours();
        majBoutonsZone();
    }

    function redessinerZoneEnCours() {
        viderCouche('zoneEnCours');
        couches.zoneEnCours = L.layerGroup(
            [L.polyline(etat.zone, { color: '#0d6efd', dashArray: '5,5', weight: 2 })].concat(
                etat.zone.map(function (p) {
                    return L.circleMarker(p, { radius: 4, color: '#0d6efd', fillOpacity: 1 });
                })
            )
        ).addTo(carte);
    }

    function terminerZone() {
        if (etat.zone.length < 3) {
            informer('Il faut au moins trois sommets pour délimiter une zone.', true);
            return;
        }

        var surfaceKm2 = surfaceZoneKm2(etat.zone);
        if (surfaceKm2 > config.limites.surfaceMaxKm2) {
            informer(
                'Zone trop vaste : ' + formaterNombre(surfaceKm2, 1) + ' km² pour un maximum de '
                + config.limites.surfaceMaxKm2 + ' km². Redessinez une zone plus petite.',
                true
            );
            return;
        }

        etat.mode = null;
        viderCouche('zoneEnCours');
        couches.zone = L.polygon(etat.zone, { color: '#0d6efd', weight: 2, fillOpacity: 0.05 }).addTo(carte);
        carte.fitBounds(couches.zone.getBounds(), { padding: [20, 20] });

        informer('Zone de ' + formaterNombre(surfaceKm2, 1) + ' km² délimitée. Chargez maintenant les obstacles.');
        activer('btnObstacles', true);
        majBoutonsZone();
        appliquerMode();
    }

    /**
     * Surface du polygone en km², par la formule du lacet (shoelace) appliquée
     * aux coordonnées projetées en mètres. Suffisant ici : on ne cherche pas
     * une surface géodésique exacte, seulement à faire respecter un plafond.
     */
    function surfaceZoneKm2(zone) {
        var projection = creerProjection(zone[0][0], zone[0][1]);
        var pts = zone.map(function (p) { return projection.versMetres(p[0], p[1]); });

        var somme = 0;
        for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            somme += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
        }
        return Math.abs(somme / 2) / 1e6;
    }

    // ------------------------------------------------------------------
    // Étape 2 — charger les obstacles (fictifs en V0)
    // ------------------------------------------------------------------
    function chargerObstacles() {
        etat.obstacles = genererObstaclesFictifs(etat.zone, config.graineDemo);
        dessinerObstacles();

        if (!worker) {
            signalerWorkerIndisponible('worker absent');
            return;
        }

        worker.postMessage({
            type: 'preparer',
            obstacles: etat.obstacles,
            origine: centreZone(etat.zone),
            zone: etat.zone,
            tailleCellule: config.calcul.tailleCellule,
        });

        informer('Génération de ' + etat.obstacles.length + ' obstacles fictifs, indexation en cours...');
    }

    var STYLES = {
        route: { color: '#dc3545', weight: 3 },
        chemin: { color: '#fd7e14', weight: 2, dashArray: '6,4' },
        batiment: { color: '#6f42c1', weight: 1, fillOpacity: 0.4 },
        infrastructure: { color: '#20c997' },
    };

    function dessinerObstacles() {
        couches.obstacles.clearLayers();

        etat.obstacles.forEach(function (o) {
            var style = STYLES[o.categorie] || { color: '#6c757d' };
            var couche;

            if (o.type === 'ligne') {
                couche = L.polyline(o.coords, style);
            } else if (o.type === 'polygone') {
                couche = L.polygon(o.coords, style);
            } else {
                couche = L.circleMarker(o.coords[0], Object.assign({ radius: 5, fillOpacity: 1 }, style));
            }

            couche.bindTooltip(o.libelle);
            couches.obstacles.addLayer(couche);
        });
    }

    /** Centre du rectangle englobant de la zone : origine du repère local. */
    function centreZone(zone) {
        var latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
        zone.forEach(function (p) {
            latMin = Math.min(latMin, p[0]); latMax = Math.max(latMax, p[0]);
            lonMin = Math.min(lonMin, p[1]); lonMax = Math.max(lonMax, p[1]);
        });
        return [(latMin + latMax) / 2, (lonMin + lonMax) / 2];
    }

    // ------------------------------------------------------------------
    // Étape 4 — point approximatif
    // ------------------------------------------------------------------
    function poserDepart(latlng) {
        etat.depart = [latlng.lat, latlng.lng];
        etat.mode = null;
        viderCouche('depart');
        couches.depart = L.marker(etat.depart).addTo(carte).bindTooltip('Point de départ');
        informer('Point de départ posé. Lancez l\'optimisation.');
        activer('btnOptimiser', true);
        appliquerMode();
    }

    // ------------------------------------------------------------------
    // Étape 5 — optimiser
    // ------------------------------------------------------------------
    function optimiser() {
        if (!worker) {
            signalerWorkerIndisponible('worker absent');
            return;
        }
        activer('btnOptimiser', false);
        couches.resultats.clearLayers();
        informer('Calcul en cours...');

        worker.postMessage({
            type: 'optimiser',
            point: etat.depart,
            options: config.calcul.optimisation,
        });
    }

    // ------------------------------------------------------------------
    // Étape 6 — examiner le résultat
    // ------------------------------------------------------------------
    var ETIQUETTES = ['A', 'B', 'C', 'D', 'E'];

    function afficherResultats(resultats, dureeMs) {
        activer('btnOptimiser', true);

        if (resultats.length === 0) {
            informer('Aucune position exploitable : le point de départ est-il bien dans la zone ?', true);
            return;
        }

        couches.resultats.clearLayers();

        resultats.forEach(function (r, rang) {
            var meilleur = rang === 0;
            var couleur = meilleur ? '#198754' : '#6c757d';

            // Le cercle matérialise le score : à l'intérieur, aucun obstacle connu.
            couches.resultats.addLayer(
                L.circle(r.latlon, {
                    radius: r.score,
                    color: couleur,
                    weight: meilleur ? 2 : 1,
                    fillOpacity: meilleur ? 0.12 : 0.05,
                })
            );

            couches.resultats.addLayer(
                L.marker(r.latlon, {
                    icon: L.divIcon({
                        className: 'sam-etiquette',
                        html: '<span style="background:' + couleur + '">' + ETIQUETTES[rang] + '</span>',
                        iconSize: [26, 26],
                        iconAnchor: [13, 13],
                    }),
                }).bindTooltip(ETIQUETTES[rang] + ' — ' + formaterDistance(r.score))
            );
        });

        carte.fitBounds(couches.resultats.getBounds(), { padding: [30, 30] });

        document.getElementById('resultats').innerHTML =
            '<h2 class="h6 mt-3">Résultats <small class="text-muted fw-normal">(' + dureeMs + ' ms)</small></h2>'
            + resultats.map(function (r, rang) { return carteResultat(r, rang); }).join('');

        informer('Calcul terminé en ' + dureeMs + ' ms.');
    }

    function carteResultat(r, rang) {
        var obstacles = r.obstacles.map(function (o, i) {
            return '<li' + (i === 0 ? ' class="fw-semibold"' : '') + '>'
                + echapper(o.libelle) + ' — ' + formaterDistance(o.distance) + '</li>';
        }).join('');

        return ''
            + '<div class="card mb-2' + (rang === 0 ? ' border-success' : '') + '">'
            + '  <div class="card-body py-2 px-3">'
            + '    <div class="d-flex justify-content-between align-items-baseline">'
            + '      <span class="fw-bold">' + ETIQUETTES[rang] + '</span>'
            + '      <span class="fs-5">' + formaterDistance(r.score) + '</span>'
            + '    </div>'
            + '    <div class="small text-muted">' + r.latlon[0].toFixed(5) + ', ' + r.latlon[1].toFixed(5) + '</div>'
            + '    <div class="small mt-1">Obstacles les plus proches :</div>'
            + '    <ul class="small mb-0 ps-3">' + obstacles + '</ul>'
            + '  </div>'
            + '</div>';
    }

    // ------------------------------------------------------------------
    // Petits utilitaires d'affichage
    // ------------------------------------------------------------------
    function formaterDistance(metres) {
        if (!isFinite(metres)) {
            return 'aucun obstacle';
        }
        return metres >= 1000
            ? formaterNombre(metres / 1000, 2) + ' km'
            : formaterNombre(metres, 0) + ' m';
    }

    function formaterNombre(valeur, decimales) {
        return valeur.toLocaleString('fr-FR', {
            minimumFractionDigits: decimales,
            maximumFractionDigits: decimales,
        });
    }

    function echapper(texte) {
        var div = document.createElement('div');
        div.textContent = texte;
        return div.innerHTML;
    }

    function informer(message, estErreur) {
        var zone = document.getElementById('message');
        zone.textContent = message;
        zone.className = 'alert py-2 px-3 mb-3 ' + (estErreur ? 'alert-warning' : 'alert-light border');
    }

    function activer(id, actif) {
        document.getElementById(id).disabled = !actif;
    }

    function viderCouche(nom) {
        if (couches[nom]) {
            carte.removeLayer(couches[nom]);
            couches[nom] = null;
        }
    }

    function majBoutonsZone() {
        activer('btnTerminerZone', etat.mode === 'zone' && etat.zone.length >= 3);
    }

    /**
     * Applique le mode courant : curseur en croix, bouton enfoncé, et surtout
     * verrouillage du déplacement de la carte.
     *
     * POURQUOI VERROUILLER. Leaflet considère qu'un appui ayant bougé de plus
     * de 3 pixels est un glisser-déposer, et n'émet alors PAS d'événement
     * 'click'. Souris un peu vivante ou pavé tactile : le sommet n'est jamais
     * posé, et l'utilisateur voit seulement la carte se déplacer sous son
     * curseur. Tant qu'on attend un clic, le déplacement est donc désactivé —
     * le clic ne peut plus être avalé, et le geste devient sans ambiguïté.
     * Le zoom (molette, boutons +/−) reste disponible pour se déplacer.
     */
    function appliquerMode() {
        var enAttenteDeClic = etat.mode !== null;

        carte.getContainer().classList.toggle('sam-mode-clic', enAttenteDeClic);
        document.getElementById('btnZone').classList.toggle('active', etat.mode === 'zone');
        document.getElementById('btnPoint').classList.toggle('active', etat.mode === 'point');

        if (enAttenteDeClic) {
            carte.dragging.disable();
        } else {
            carte.dragging.enable();
        }
    }

    // ------------------------------------------------------------------
    // Branchements
    // ------------------------------------------------------------------
    carte.on('click', function (e) {
        if (etat.mode === 'zone') {
            ajouterSommet(e.latlng);
        } else if (etat.mode === 'point') {
            poserDepart(e.latlng);
        }
    });

    carte.on('dblclick', function () {
        if (etat.mode === 'zone') {
            terminerZone();
        }
    });

    document.getElementById('btnZone').addEventListener('click', demarrerDessinZone);
    document.getElementById('btnTerminerZone').addEventListener('click', terminerZone);
    document.getElementById('btnObstacles').addEventListener('click', chargerObstacles);
    document.getElementById('btnOptimiser').addEventListener('click', optimiser);

    document.getElementById('btnPoint').addEventListener('click', function () {
        etat.mode = 'point';
        informer('Cliquez sur la carte l\'endroit qui vous paraît intéressant. '
            + 'La carte est verrouillée jusqu\'à ce que le point soit posé.');
        appliquerMode();
    });

    // Le conteneur de la carte est dimensionné par flexbox : on redemande à
    // Leaflet de mesurer sa taille une fois la mise en page stabilisée, sinon
    // les tuiles et les clics peuvent être décalés au premier affichage.
    window.addEventListener('load', function () {
        carte.invalidateSize();
    });

    informer('Commencez par délimiter la zone à étudier.');
})();
