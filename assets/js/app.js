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
        mode: null,        // 'point' quand l'application attend un clic sur la carte, sinon null
        zone: [],          // sommets de la zone, en [lat, lon]
        obstacles: [],     // format interne (§7 du cahier)
        depart: null,      // point approximatif choisi, en [lat, lon]
    };

    // featureGroup et non layerGroup : seul le premier sait calculer le
    // rectangle englobant de son contenu (getBounds), dont on a besoin pour
    // cadrer la carte sur les résultats.
    var couches = {
        zone: null,
        obstacles: L.featureGroup(),
        depart: null,
        resultats: L.featureGroup(),
    };

    var poignees = [];

    // ------------------------------------------------------------------
    // Carte — créée seulement quand on sait OÙ regarder
    // ------------------------------------------------------------------
    // Leaflet ne télécharge aucune tuile tant que la carte n'a pas de vue.
    // On diffère donc sa création jusqu'à ce que l'utilisateur ait donné un
    // code postal (ou choisi d'explorer). Sur une connexion lente, cela évite
    // de charger les tuiles d'un pays entier pour finir par les jeter.
    var carte = null;

    function demarrerCarte(centre, zoom) {
        carte = L.map('carte', { doubleClickZoom: false }).setView(centre, zoom);

        L.tileLayer(config.tuiles.url, {
            maxZoom: config.tuiles.maxZoom,
            attribution: config.tuiles.attribution,
        }).addTo(carte);

        couches.obstacles.addTo(carte);
        couches.resultats.addTo(carte);

        carte.on('click', function (e) {
            if (etat.mode === 'point') {
                poserDepart(e.latlng);
            }
        });

        document.getElementById('accueil').style.display = 'none';
        activer('btnZone', true);
        informer('Placez le rectangle de zone, puis ajustez-le avec ses poignées.');
    }

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
    // Étape 1 — délimiter la zone (rectangle redimensionnable)
    // ------------------------------------------------------------------
    // Un rectangle à poignées plutôt qu'un polygone à main levée : c'est le
    // geste le plus court pour délimiter un secteur, et il suffit largement
    // ici, la zone ne servant qu'à borner la recherche et, plus tard, les
    // requêtes vers Overpass. Toujours pas de plugin de dessin (§15 du
    // cahier) : un L.rectangle et quatre marqueurs déplaçables y pourvoient.

    function placerRectangle() {
        effacerZone();
        reinitialiserEtapesSuivantes();

        // Rectangle centré sur la vue courante, occupant sa moitié : assez
        // grand pour être saisi immédiatement, assez petit pour rester sous le
        // plafond de surface dans la plupart des cas.
        var vue = carte.getBounds();
        var centre = vue.getCenter();
        var dLat = (vue.getNorth() - vue.getSouth()) / 4;
        var dLon = (vue.getEast() - vue.getWest()) / 4;

        dessinerRectangle(L.latLngBounds(
            [centre.lat - dLat, centre.lng - dLon],
            [centre.lat + dLat, centre.lng + dLon]
        ));

        majZoneDepuisRectangle();
    }

    /** Les quatre coins, dans un ordre où l'opposé de i est toujours (i + 2) % 4. */
    function coinsDe(limites) {
        return [
            limites.getSouthWest(),
            limites.getNorthWest(),
            limites.getNorthEast(),
            limites.getSouthEast(),
        ];
    }

    function dessinerRectangle(limites) {
        couches.zone = L.rectangle(limites, {
            color: '#0d6efd',
            weight: 2,
            fillOpacity: 0.05,
        }).addTo(carte);

        coinsDe(limites).forEach(function (coin, i) {
            var poignee = L.marker(coin, {
                draggable: true,
                icon: L.divIcon({ className: 'sam-poignee', iconSize: [16, 16], iconAnchor: [8, 8] }),
            }).addTo(carte);

            // Le coin diagonalement opposé est figé au début du geste. Le
            // relire à chaque déplacement serait faux : il bougerait avec le
            // rectangle qu'on est en train de redéfinir.
            var coinFixe = null;

            poignee.on('dragstart', function () {
                coinFixe = coinsDe(couches.zone.getBounds())[(i + 2) % 4];
            });

            poignee.on('drag', function () {
                couches.zone.setBounds(L.latLngBounds(poignee.getLatLng(), coinFixe));
                repositionnerPoignees(poignee);
                afficherSurface();
            });

            poignee.on('dragend', function () {
                // En tirant une poignée au-delà de l'opposée, les coins
                // s'inversent : on les remet tous d'aplomb à la fin du geste.
                repositionnerPoignees(null);
                majZoneDepuisRectangle();
            });

            poignees.push(poignee);
        });
    }

    function repositionnerPoignees(sauf) {
        var coins = coinsDe(couches.zone.getBounds());
        poignees.forEach(function (poignee, i) {
            if (poignee !== sauf) {
                poignee.setLatLng(coins[i]);
            }
        });
    }

    function effacerZone() {
        viderCouche('zone');
        poignees.forEach(function (poignee) { carte.removeLayer(poignee); });
        poignees = [];
        etat.zone = [];
    }

    /** Recopie le rectangle dans l'état, et rouvre l'étape suivante si la surface le permet. */
    function majZoneDepuisRectangle() {
        etat.zone = coinsDe(couches.zone.getBounds()).map(function (c) { return [c.lat, c.lng]; });

        reinitialiserEtapesSuivantes();
        activer('btnObstacles', afficherSurface() <= config.limites.surfaceMaxKm2);
    }

    /** Affiche la surface courante et retourne sa valeur en km². */
    function afficherSurface() {
        var coins = coinsDe(couches.zone.getBounds()).map(function (c) { return [c.lat, c.lng]; });
        var surface = surfaceZoneKm2(coins);

        if (surface > config.limites.surfaceMaxKm2) {
            informer('Zone de ' + formaterNombre(surface, 1) + ' km², au-delà du maximum de '
                + config.limites.surfaceMaxKm2 + ' km². Réduisez le rectangle.', true);
        } else {
            informer('Zone de ' + formaterNombre(surface, 1) + ' km². Ajustez-la avec les poignées, '
                + 'puis chargez les obstacles.');
        }

        return surface;
    }

    /**
     * Toute modification de la zone périme ce qui en découle : les obstacles
     * ne correspondent plus, le point de départ et les résultats non plus.
     * Mieux vaut les effacer que laisser à l'écran des données qui ne sont
     * plus celles de la zone affichée.
     */
    function reinitialiserEtapesSuivantes() {
        etat.obstacles = [];
        etat.depart = null;
        etat.mode = null;

        couches.obstacles.clearLayers();
        couches.resultats.clearLayers();
        viderCouche('depart');
        document.getElementById('resultats').innerHTML = '';

        activer('btnObstacles', false);
        activer('btnPoint', false);
        activer('btnOptimiser', false);
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
            var classes = [];
            if (i === 0) { classes.push('fw-semibold'); }
            // Le bord de la zone n'est pas un obstacle réel mais l'aveu d'une
            // ignorance : il se lit différemment du reste de la liste.
            if (o.categorie === 'limite') { classes.push('text-warning-emphasis', 'fst-italic'); }

            return '<li' + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + '>'
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
            + '    <div class="small mt-1">Éléments limitants :</div>'
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

    /**
     * Applique le mode courant : curseur en croix, bouton enfoncé, et surtout
     * verrouillage du déplacement de la carte.
     *
     * POURQUOI VERROUILLER. Leaflet considère qu'un appui ayant bougé de plus
     * de 3 pixels est un glisser-déposer, et n'émet alors PAS d'événement
     * 'click'. Souris un peu vivante ou pavé tactile : le point n'est jamais
     * posé, et l'utilisateur voit seulement la carte se déplacer sous son
     * curseur. Tant qu'on attend un clic, le déplacement est donc désactivé —
     * le clic ne peut plus être avalé, et le geste devient sans ambiguïté.
     * Le zoom (molette, boutons +/−) reste disponible pour se déplacer.
     */
    function appliquerMode() {
        var enAttenteDeClic = etat.mode !== null;

        carte.getContainer().classList.toggle('sam-mode-clic', enAttenteDeClic);
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
    document.getElementById('btnZone').addEventListener('click', placerRectangle);
    document.getElementById('btnObstacles').addEventListener('click', chargerObstacles);
    document.getElementById('btnOptimiser').addEventListener('click', optimiser);

    document.getElementById('btnPoint').addEventListener('click', function () {
        etat.mode = 'point';
        informer('Cliquez sur la carte l\'endroit qui vous paraît intéressant. '
            + 'La carte est verrouillée jusqu\'à ce que le point soit posé.');
        appliquerMode();
    });

    // ------------------------------------------------------------------
    // Écran d'accueil : trouver le point de départ avant d'afficher la carte
    // ------------------------------------------------------------------
    function messageAccueil(texte, estErreur) {
        var zone = document.getElementById('accueilMessage');
        zone.textContent = texte;
        zone.className = 'small mt-2 ' + (estErreur ? 'text-danger' : 'text-muted');
    }

    document.getElementById('formAccueil').addEventListener('submit', function (e) {
        e.preventDefault();

        var codePostal = document.getElementById('cp').value.trim();
        var bouton = document.getElementById('btnAccueil');

        bouton.disabled = true;
        messageAccueil('Recherche du code postal...');

        // Le géocodage passe par notre proxy : le navigateur ne connaît aucune
        // URL de fournisseur, et le cache serveur évite de solliciter Nominatim
        // pour un code postal déjà résolu.
        fetch(config.cheminGeocodage + '?cp=' + encodeURIComponent(codePostal))
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, donnees: d }; }); })
            .then(function (reponse) {
                if (!reponse.ok) {
                    throw new Error(reponse.donnees.erreur || 'recherche impossible');
                }
                demarrerCarte([reponse.donnees.lat, reponse.donnees.lon], config.zoomTravail);
            })
            .catch(function (erreur) {
                messageAccueil(erreur.message, true);
                bouton.disabled = false;
            });
    });

    // Porte de sortie : hors de France, ou simplement pour se promener. On
    // retombe alors sur la vue large, en assumant le chargement de tuiles.
    document.getElementById('btnExplorer').addEventListener('click', function () {
        demarrerCarte(config.vueInitiale, config.zoomInitial);
    });

    document.getElementById('cp').focus();
    informer('Indiquez un code postal pour ouvrir la carte au bon endroit.');
})();
