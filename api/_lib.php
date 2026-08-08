<?php
/**
 * _lib.php — briques communes aux points d'entrée de api/.
 *
 * Rôle    : répondre en JSON, appeler un fournisseur externe, et mettre les
 *           réponses en cache dans SQLite.
 * Entrées : la configuration de l'application (inc/inc_lib.php).
 * Sorties : les fonctions ci-dessous.
 * Dépend  : PDO SQLite ; cURL si présent, sinon les flux PHP.
 *
 * Principe directeur (§16 du cahier) : tout ce qui vient du navigateur est
 * suspect. Aucun point d'entrée ne relaie une URL fournie par le client ; le
 * fournisseur est choisi ici, côté serveur, à partir de la configuration.
 */

require_once __DIR__ . '/../inc/inc_lib.php';

/** Répond en JSON et termine la requête. */
function repondreJson(array $donnees, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($donnees, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Répond une erreur lisible par un humain, et termine la requête. */
function repondreErreur(string $message, int $code = 400): never
{
    repondreJson(['erreur' => $message], $code);
}

/**
 * Connexion au cache SQLite, créé au premier appel.
 *
 * Le cache est la seule base du projet, et il ne contient que des réponses de
 * fournisseurs publics : aucune donnée personnelle, aucune recherche
 * individuelle (§11 du cahier). La clé est un hachage de la requête, jamais
 * la requête elle-même accompagnée d'un identifiant d'utilisateur.
 */
function cache(): PDO
{
    static $pdo = null;

    if ($pdo === null) {
        $chemin = config()['db']['path'];
        $pdo = new PDO('sqlite:' . $chemin, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);

        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS cache (
                cle        TEXT PRIMARY KEY,
                valeur     TEXT NOT NULL,
                expire_le  INTEGER NOT NULL
            )'
        );
    }

    return $pdo;
}

/** Valeur en cache si elle existe et n'a pas expiré, sinon null. */
function cacheLire(string $cle): ?string
{
    $stmt = cache()->prepare('SELECT valeur FROM cache WHERE cle = :cle AND expire_le > :maintenant');
    $stmt->execute(['cle' => $cle, 'maintenant' => time()]);
    $ligne = $stmt->fetch();

    return $ligne ? $ligne['valeur'] : null;
}

/** Enregistre une valeur pour $ttl secondes. */
function cacheEcrire(string $cle, string $valeur, int $ttl): void
{
    $stmt = cache()->prepare(
        'INSERT INTO cache (cle, valeur, expire_le) VALUES (:cle, :valeur, :expire)
         ON CONFLICT(cle) DO UPDATE SET valeur = :valeur, expire_le = :expire'
    );
    $stmt->execute(['cle' => $cle, 'valeur' => $valeur, 'expire' => time() + $ttl]);

    // Ménage opportuniste : sans cela, la base ne ferait que grossir.
    cache()->exec('DELETE FROM cache WHERE expire_le < ' . (time() - 86400));
}

/**
 * Fait patienter le temps nécessaire pour ne pas dépasser la cadence maximale
 * autorisée par un fournisseur.
 *
 * POURQUOI. Nominatim comme Overpass sont des services publics gratuits,
 * financés par des dons, avec des règles d'usage explicites (au plus une
 * requête par seconde pour Nominatim). Les ignorer, c'est se faire bloquer —
 * et surtout faire porter le coût de son application à un bien commun. La
 * cadence est donc tenue ici, côté serveur, où elle s'applique à TOUS les
 * visiteurs, et non dans le navigateur de chacun.
 */
function respecterCadence(string $fournisseur, float $intervalleMin): void
{
    $cle = 'cadence:' . $fournisseur;
    $stmt = cache()->prepare('SELECT valeur FROM cache WHERE cle = :cle');
    $stmt->execute(['cle' => $cle]);
    $ligne = $stmt->fetch();

    $dernierAppel = $ligne ? (float) $ligne['valeur'] : 0.0;
    $attente = $intervalleMin - (microtime(true) - $dernierAppel);

    if ($attente > 0) {
        usleep((int) ($attente * 1_000_000));
    }

    // Horodatage stocké très loin dans le futur : ce n'est pas un cache, on ne
    // veut pas que le ménage l'efface entre deux requêtes.
    cacheEcrire($cle, (string) microtime(true), 86400 * 365);
}

/**
 * Appelle une URL de fournisseur et retourne son corps de réponse.
 *
 * L'URL est TOUJOURS construite par l'appelant à partir de la configuration,
 * jamais reçue du navigateur : ce proxy ne doit jamais devenir un relais HTTP
 * ouvert (§16 du cahier).
 *
 * Utilise cURL s'il est disponible, sinon les flux PHP — beaucoup
 * d'hébergements mutualisés désactivent l'un ou l'autre.
 *
 * @throws RuntimeException en cas d'échec réseau, de dépassement de délai ou
 *         de réponse trop volumineuse.
 */
function appelerFournisseur(string $url, int $timeout, int $tailleMaxOctets): string
{
    $agent = config()['app_name'] . '/0.1 (+https://github.com/fran6t/sam-osm)';

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_USERAGENT      => $agent,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXFILESIZE    => $tailleMaxOctets,
        ]);

        $corps = curl_exec($curl);
        $erreur = curl_error($curl);
        $codeHttp = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);

        if ($corps === false) {
            throw new RuntimeException('appel au fournisseur impossible : ' . $erreur);
        }
    } else {
        $contexte = stream_context_create(['http' => [
            'method'  => 'GET',
            'timeout' => $timeout,
            'header'  => "User-Agent: $agent\r\n",
            'ignore_errors' => true,
        ]]);

        $corps = @file_get_contents($url, false, $contexte, 0, $tailleMaxOctets + 1);
        if ($corps === false) {
            throw new RuntimeException('appel au fournisseur impossible (flux PHP)');
        }

        $codeHttp = 200;
        if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
            $codeHttp = (int) $m[1];
        }
    }

    if ($codeHttp !== 200) {
        throw new RuntimeException("le fournisseur a répondu $codeHttp");
    }

    if (strlen($corps) > $tailleMaxOctets) {
        throw new RuntimeException('réponse du fournisseur trop volumineuse');
    }

    return $corps;
}
