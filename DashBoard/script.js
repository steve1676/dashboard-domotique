// ─── Stockage local versionné ────────────────────────────────────────────────
// Petit wrapper autour de localStorage : chaque valeur est enregistrée avec un
// numéro de version de schéma. Si le format d'une donnée change un jour, il
// suffit d'incrémenter son numéro ici pour que les anciennes valeurs (au
// format obsolète) soient ignorées automatiquement au lieu de faire planter
// le code ou d'afficher des données corrompues — exactement le genre de bug
// qu'on a eu une fois avec le cache des lignes de transport.
//
// Les données déjà enregistrées avant ce wrapper (format brut, sans version)
// sont migrées silencieusement au premier accès : rien n'est perdu.

const DASHBOARD_STORAGE_VERSIONS = {
    transport_routes_config: 1,
    phones_config: 1,
    widgets_visibility: 1,
    favorites: 1,
    widgetOrder: 1,
    chromecast_yt_thumb_cache: 1,
    display_schedule: 1,
    chromecast_watch_history: 2,
    chromecast_genre_prefs: 1,
    spotify_display_style: 1,
};

function storageGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;

        const parsed = JSON.parse(raw);
        const expectedVersion = DASHBOARD_STORAGE_VERSIONS[key] ?? 1;

        // Format versionné déjà en place
        if (parsed && typeof parsed === "object" && "__v" in parsed) {
            return parsed.__v === expectedVersion ? parsed.value : fallback;
        }

        // Ancien format brut (avant ce wrapper) : migration silencieuse, rien de perdu
        storageSet(key, parsed);
        return parsed;
    } catch (err) {
        return fallback;
    }
}

function storageSet(key, value) {
    const version = DASHBOARD_STORAGE_VERSIONS[key] ?? 1;
    localStorage.setItem(key, JSON.stringify({ __v: version, value }));
}


// ─── Horloge ────────────────────────────────────────────────────────────────

function updateClock() {
    const now = new Date();

    document.getElementById("time").textContent =
        now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    document.getElementById("date").textContent =
        now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

setInterval(updateClock, 1000);
updateClock();


// ─── Météo ──────────────────────────────────────────────────────────────────

function openWidgetModal(section) {
    document.querySelectorAll('.widget-modal-section').forEach(el => el.classList.remove('visible'));
    document.getElementById('modal-' + section).classList.add('visible');
    document.getElementById('widgetModal').classList.add('visible');

    if (section === 'transport') {
        showTransportView('home');
    } else {
        const mainClose = document.getElementById("mainModalClose");
        if (mainClose) mainClose.style.display = "";
    }
}

function closeWidgetModal() {
    document.getElementById('widgetModal').classList.remove('visible');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWidgetModal();
});

function getWeatherIcon(code, hour = new Date().getHours()) {
    const isNight = hour < 7 || hour >= 21;

    if ([0].includes(code))                         return isNight ? "🌕" : "☀️";
    if ([1, 2, 3].includes(code))                   return isNight ? "☁️" : "⛅";
    if ([45, 48].includes(code))                    return "🌫️";
    if ([51, 53, 55, 61, 63, 65].includes(code))    return "🌧️";
    if ([71, 73, 75, 77].includes(code))            return "❄️";
    if ([95, 96, 99].includes(code))                return "⛈️";
    return "☁️";
}

async function getWeather(lat, lon) {
    const loader  = document.getElementById("weather-loader");
    const content = document.getElementById("weather-content");

    loader.classList.add("visible");
    content.classList.add("loading");

    try {
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code&hourly=temperature_2m,weather_code`
        );
        const data = await response.json();

        const tempText = Math.round(data.current.temperature_2m) + "°C";
        const iconText = getWeatherIcon(data.current.weather_code);

        document.getElementById("temp").textContent      = tempText;
        document.getElementById("tempModal").textContent = tempText;
        document.getElementById("feels").textContent     = Math.round(data.current.apparent_temperature);
        document.getElementById("humidity").textContent  = data.current.relative_humidity_2m;
        document.getElementById("weatherIcon").textContent      = iconText;
        document.getElementById("weatherIconModal").textContent = iconText;
        applyWeatherBackground(data.current.weather_code);

        const forecastContainer = document.getElementById("forecast");
        const currentHour = new Date().getHours();

        const totalHours = data.hourly.temperature_2m.length;
        const maxHours = Math.min(totalHours, currentHour + 24);
        // On construit le HTML dans une simple chaîne, puis on l'injecte une
        // seule fois — "innerHTML +=" dans une boucle reconstruit et
        // reparse TOUT le contenu déjà généré à chaque itération (au lieu
        // de juste ajouter le nouvel élément), ce qui devient très lourd
        // sur du matériel faible avec 24 itérations et une image de fond
        // par élément.
        let forecastHtml = "";
        for (let i = 1; currentHour + i < maxHours; i++) {
            const hour = (currentHour + i) % 24;
            const temp = Math.round(data.hourly.temperature_2m[currentHour + i]);
            const hCode = data.hourly.weather_code[currentHour + i];
            const hIcon = getWeatherIcon(hCode, hour);
            const hBg   = getWeatherImage(hCode, hour);
            const dayMark = hour === 0 ? `<div class="forecast-day">demain</div>` : "";
            forecastHtml += `
                <div class="forecast-item" style="background-image:url('${hBg}')">
                    ${dayMark}
                    <div class="forecast-hour">${hour}h</div>
                    <div class="forecast-icon">${hIcon}</div>
                    <div class="forecast-temp">${temp}°</div>
                </div>`;
        }
        forecastContainer.innerHTML = forecastHtml;

    } catch (err) {
        console.error("Météo :", err);
        document.getElementById("temp").textContent = "⚠️";

    } finally {
        loader.classList.remove("visible");
        content.classList.remove("loading");
    }
}

async function getCityName(lat, lon) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=fr`,
            { headers: { "Accept-Language": "fr" } }
        );
        const data = await response.json();
        // Priorité : ville > commune > village > comté
        return data.address?.city
            || data.address?.town
            || data.address?.village
            || data.address?.county
            || "Position actuelle";
    } catch (err) {
        console.error("Geocoding :", err);
        return "Position actuelle";
    }
}

let lastLat = null;
let lastLon = null;
let weatherInterval = null;

async function updateLocation(latitude, longitude) {
    // Ne rafraîchit que si on s'est déplacé de plus de ~200m
    if (lastLat !== null) {
        const dist = Math.hypot(latitude - lastLat, longitude - lastLon);
        if (dist < 0.002) return; // ~200m en degrés
    }
    lastLat = latitude;
    lastLon = longitude;

    getWeather(latitude, longitude);

    const cityEl = document.getElementById("city");
    cityEl.textContent = " Localisation...";
    const name = await getCityName(latitude, longitude);
    cityEl.textContent =  name;

    // Rafraîchit la météo toutes les 10 min pour la même position
    clearInterval(weatherInterval);
    weatherInterval = setInterval(() => getWeather(latitude, longitude), 600000);
}

// Une seule lecture de position à faible précision : suffisant pour la météo
// (le dashboard reste toujours au même endroit), et bien moins gourmand
// qu'un watchPosition en haute précision qui garderait le GPS actif en
// permanence.
navigator.geolocation.getCurrentPosition(
    position => updateLocation(position.coords.latitude, position.coords.longitude),
    error => {
        console.error(error);
        getWeather(47.2172, -1.5534);
        document.getElementById("city").textContent = "Nantes";
    },
    { enableHighAccuracy: false, maximumAge: 30 * 60000, timeout: 10000 }
);

// ─── Plage d'affichage (mode nuit programmé) ─────────────────────────────────
// En dehors des heures choisies dans les Paramètres : écran noir plein (vrais
// pixels éteints sur AMOLED) + relâchement du Wake Lock pour laisser Android
// mettre la tablette en veille normalement après son délai système.

let wakeLock = null;
let nightModeSnoozeUntil = 0; // tap sur l'écran noir = pause temporaire
let backgroundPollingPaused = false;

// Identifiants des boucles mises en pause pendant le mode nuit (déclarés ici,
// affectés plus loin dans le fichier là où chaque boucle démarre réellement)
let haInterval, transportInterval, infotraficInterval, phoneSelectInterval, spotifyInterval;

function getDisplaySchedule() {
    return storageGet("display_schedule", {
        enabled: false,
        start: "07:00",
        end: "23:00",
        alwaysOff: false,
        wakeDuration: 60
    });
}

function saveDisplaySchedule() {
    const schedule = {
        enabled: document.getElementById("chk-display-schedule").checked,
        start: document.getElementById("display-schedule-start").value || "07:00",
        end: document.getElementById("display-schedule-end").value || "23:00",
        alwaysOff: document.getElementById("chk-always-off").checked,
        wakeDuration: parseInt(document.getElementById("wake-duration-select").value, 10) || 60
    };
    storageSet("display_schedule", schedule);
    checkDisplaySchedule();
}

function onDisplayScheduleToggle(enabled) {
    saveDisplaySchedule();
}

function initDisplaySchedule() {
    const schedule = getDisplaySchedule();
    document.getElementById("chk-display-schedule").checked = schedule.enabled;
    document.getElementById("display-schedule-start").value = schedule.start;
    document.getElementById("display-schedule-end").value = schedule.end;
    document.getElementById("chk-always-off").checked = schedule.alwaysOff;
    document.getElementById("wake-duration-select").value = String(schedule.wakeDuration);
    checkDisplaySchedule();
}

function isWithinSchedule(schedule) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const [sh, sm] = schedule.start.split(":").map(Number);
    const [eh, em] = schedule.end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin   = eh * 60 + em;

    if (startMin === endMin) return true; // plage nulle : toujours allumé
    if (startMin < endMin) {
        // plage classique dans la même journée (ex: 07:00 → 23:00)
        return nowMin >= startMin && nowMin < endMin;
    }
    // plage à cheval sur minuit (ex: 22:00 → 06:00)
    return nowMin >= startMin || nowMin < endMin;
}

async function requestWakeLock() {
    try {
        if (!("wakeLock" in navigator)) return;
        wakeLock = await navigator.wakeLock.request("screen");
    } catch (err) {
        console.error("Wake Lock indisponible :", err);
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
}

function pauseBackgroundPolling() {
    if (backgroundPollingPaused) return;
    backgroundPollingPaused = true;

    clearInterval(haInterval);
    clearInterval(transportInterval);
    clearInterval(infotraficInterval);
    clearInterval(phoneSelectInterval);
    clearInterval(spotifyInterval);
}

function resumeBackgroundPolling() {
    if (!backgroundPollingPaused) return;
    backgroundPollingPaused = false;

    haInterval        = setInterval(haFetchStates, 5000);
    transportInterval = setInterval(updateTransports, 60000);
    infotraficInterval = setInterval(updateInfotrafic, 5 * 60 * 1000);
    phoneSelectInterval = setInterval(refreshPhoneEntitySelect, 30000);
    if (typeof spotifyUpdatePlayer === "function") spotifyInterval = setInterval(spotifyUpdatePlayer, 5000);

    // Rafraîchit tout de suite au réveil pour ne pas afficher des données périmées
    haFetchStates();
    updateTransports();
    updateInfotrafic();
}

function checkDisplaySchedule() {
    const schedule = getDisplaySchedule();
    const overlay = document.getElementById("nightOverlay");
    if (!overlay) return;

    const snoozing = Date.now() < nightModeSnoozeUntil;

    let shouldBeOn;
    if (schedule.alwaysOff) {
        // Mode "toujours éteint" : noir en permanence, sauf pendant l'aperçu après un toucher
        shouldBeOn = snoozing;
    } else if (schedule.enabled) {
        shouldBeOn = isWithinSchedule(schedule) || snoozing;
    } else {
        shouldBeOn = true;
    }

    if (shouldBeOn) {
        overlay.classList.remove("active");
        requestWakeLock();
        resumeBackgroundPolling();
    } else {
        overlay.classList.add("active");
        releaseWakeLock();
        pauseBackgroundPolling();
    }
}

function wakeFromNightMode() {
    const schedule = getDisplaySchedule();
    nightModeSnoozeUntil = Date.now() + (schedule.wakeDuration * 1000);
    checkDisplaySchedule();
}

// Le Wake Lock se relâche automatiquement si l'onglet passe en arrière-plan ;
// on le redemande dès qu'il redevient visible, s'il doit être allumé.
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkDisplaySchedule();
});

initDisplaySchedule();
setInterval(checkDisplaySchedule, 5000); // vérifie toutes les 5s (réactif même sur un aperçu de 30s)


// ─── Transports — Temps réel Naolib via plan.naolib.fr ──────────────────────
// Le sélecteur ligne/arrêt/direction (page Paramètres) couvre tout le réseau
// Naolib : un seul fetch de logical_stops.geojson donne tous les arrêts avec
// leurs lignes (linked_lines) et coordonnées GPS, sans appel API par arrêt.
// Les arrêts d'une ligne sont ensuite triés par proximité GPS (plus proche
// voisin en partant des deux points les plus éloignés) pour approximer
// l'ordre de passage réel — ce fichier ne fournit pas de rang officiel. Cette
// approximation reste utilisée pour peupler les listes d'arrêts (peu importe
// l'ordre), mais PAS pour la barre "Approche estimée" : voir stops-order.json
// et loadNaolibStopOrder() plus bas, qui utilisent le vrai ordre GTFS.

const NAOLIB_GEOJSON_URL  = "https://plan.naolib.fr/map/logical_stops.geojson";
const NAOLIB_API_BASE     = "https://plan.naolib.fr/api/stop/logical/";

// Ordre RÉEL de passage des arrêts par ligne + direction. Remplace le tri GPS
// ci-dessus pour la barre "Approche estimée" : l'aller et le retour d'une
// ligne sont souvent tout proches en GPS (arrêts de part et d'autre de la
// rue) mais pas du tout consécutifs dans le vrai trajet, ce qui rendait la
// barre incohérente. stop_times.txt du GTFS officiel donne le VRAI ordre.
//
// stops-order.json est un fichier STATIQUE, régénéré par
// build-naolib-stop-order.mjs — exécuté automatiquement par le workflow
// GitHub Actions .github/workflows/update-naolib-stop-order.yml (1x/mois +
// déclenchement manuel possible depuis l'onglet Actions de GitHub, sans
// terminal). Le fichier est commité dans le dépôt et servi tel quel par
// GitHub Pages : simple fetch same-origin ici, aucun souci de CORS, puisque
// le téléchargement du GTFS se fait côté GitHub Actions, jamais dans le
// navigateur du visiteur.
const NAOLIB_STOP_ORDER_URL = "stops-order.json";
let naolibStopOrder = null; // ligne -> [{ directionId, headsign, headsignNormalized, stops: [nom, ...] }]

async function loadNaolibStopOrder() {
    try {
        const res = await fetch(NAOLIB_STOP_ORDER_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        naolibStopOrder = await res.json();
    } catch (err) {
        // Pas bloquant : getEstimatedApproachStops() retombe sur l'ordre GPS
        // approximatif tant que ce fichier est absent ou invalide (ex. avant
        // le premier passage du workflow GitHub Actions).
        console.warn("stops-order.json indisponible, repli sur l'ordre GPS approximatif :", err.message);
    }
}
const LINES_CACHE_KEY      = "transport_lines_index_cache";
const LINES_CACHE_MAX_AGE  = 30 * 24 * 60 * 60 * 1000; // 30 jours avant rescan auto

const stopDataCache = {};    // stopId -> dernière réponse de l'API par arrêt (cache mémoire, pour les directions)
let linesIndex = {};         // number -> { id, number, stops: [{id, name, lat, lng}, ...] (triés par proximité) }

function getTransportRoutes() {
    return storageGet("transport_routes_config", []);
}

function saveTransportRoutes(routes) {
    storageSet("transport_routes_config", routes);
}

async function fetchNaolibStop(stopId) {
    if (stopDataCache[stopId]) return stopDataCache[stopId];
    const res = await fetch(NAOLIB_API_BASE + stopId);
    if (!res.ok) throw new Error("HTTP " + res.status + " pour l'arrêt " + stopId);
    const data = await res.json();
    stopDataCache[stopId] = data;
    return data;
}

function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = deg => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// Approxime l'ordre de passage d'une ligne à partir des positions GPS :
// on part des deux arrêts les plus éloignés (proxy des deux terminus), puis
// on enchaîne toujours vers l'arrêt non visité le plus proche. Imparfait sur
// les lignes en boucle ou avec embranchements, mais donne un ordre cohérent
// pour l'immense majorité des lignes.
function sortStopsByProximity(stops) {
    if (stops.length <= 2) return stops;

    let maxDist = -1, startIdx = 0;
    for (let i = 0; i < stops.length; i++) {
        for (let j = i + 1; j < stops.length; j++) {
            const d = haversineMeters(stops[i], stops[j]);
            if (d > maxDist) {
                maxDist = d;
                startIdx = i;
            }
        }
    }

    const remaining = stops.slice();
    const ordered = [remaining.splice(startIdx, 1)[0]];

    while (remaining.length) {
        const last = ordered[ordered.length - 1];
        let nearestIdx = 0, nearestDist = Infinity;
        remaining.forEach((s, idx) => {
            const d = haversineMeters(last, s);
            if (d < nearestDist) {
                nearestDist = d;
                nearestIdx = idx;
            }
        });
        ordered.push(remaining.splice(nearestIdx, 1)[0]);
    }

    return ordered;
}

const LINES_CACHE_SCHEMA_VERSION = 2; // à incrémenter à chaque changement de forme de linesIndex

function loadCachedLinesIndex() {
    try {
        const raw = localStorage.getItem(LINES_CACHE_KEY);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (!cached || !cached.builtAt || !cached.index) return null;
        if (cached.schemaVersion !== LINES_CACHE_SCHEMA_VERSION) return null; // ancien format : on ignore, force un rescan
        return cached;
    } catch (err) {
        return null;
    }
}

function saveLinesIndexToCache() {
    localStorage.setItem(LINES_CACHE_KEY, JSON.stringify({
        schemaVersion: LINES_CACHE_SCHEMA_VERSION,
        builtAt: Date.now(),
        index: linesIndex
    }));
}

function showLinesCacheInfo(builtAt, scanning, elapsedMs) {
    const el = document.getElementById("transport-lines-info");
    if (!el) return;

    if (scanning) {
        el.innerHTML = `${ICON_REFRESH} Analyse des lignes en cours...`;
        return;
    }
    if (!builtAt) {
        el.innerHTML = "";
        return;
    }

    const days = Math.floor((Date.now() - builtAt) / (24 * 60 * 60 * 1000));
    const ago  = days <= 0 ? "aujourd'hui" : days === 1 ? "il y a 1 jour" : `il y a ${days} jours`;
    const timing = elapsedMs != null ? ` — analysée en ${(elapsedMs / 1000).toFixed(1)}s` : "";
    el.innerHTML = `${ICON_CHECK} Lignes à jour (dernière analyse : ${ago}${timing}) · <a href="#" onclick="forceLinesRescan(); return false;">rescanner maintenant</a>`;
}

function showLinesFetchError(fallbackBuiltAt, restrictedMode) {
    const el = document.getElementById("transport-lines-info");
    if (!el) return;

    let base;
    if (restrictedMode) {
        base = `${ICON_ALERT} Fichier Naolib inaccessible — mode restreint (uniquement tes lignes déjà configurées)`;
    } else {
        base = `${ICON_ALERT} Échec du chargement des lignes (le fichier Naolib a peut-être changé d'adresse)`;
        if (fallbackBuiltAt) {
            const days = Math.floor((Date.now() - fallbackBuiltAt) / (24 * 60 * 60 * 1000));
            const ago  = days <= 0 ? "aujourd'hui" : days === 1 ? "il y a 1 jour" : `il y a ${days} jours`;
            base += ` — dernières données valides conservées (${ago})`;
        }
    }
    el.innerHTML = `${base} · <a href="#" onclick="forceLinesRescan(); return false;">réessayer</a>`;
}

// Solution de secours si le geojson est inaccessible ET qu'aucun cache n'existe :
// reconstruit un index partiel via l'API, mais seulement pour les arrêts déjà
// utilisés dans les lignes de transport configurées (on connaît déjà leur
// stopId). Couverture limitée à ces arrêts — pas de tri GPS (peu d'arrêts,
// pas besoin) — mais évite une page de paramètres totalement vide.
async function buildLinesIndexFallbackFromRoutes() {
    const routes = getTransportRoutes();
    const stopIds = [...new Set(routes.map(r => r.stopId))];
    if (stopIds.length === 0) return false;

    const fallbackIndex = {};

    await Promise.all(stopIds.map(async (stopId) => {
        try {
            const data = await fetchNaolibStop(stopId);
            const stopLabel = routes.find(r => r.stopId === stopId)?.stopLabel || stopId;

            (data.linked_lines || []).forEach(line => {
                const number = String(line.number ?? line.id);
                if (!fallbackIndex[number]) {
                    fallbackIndex[number] = { id: number, number, stops: [] };
                }
                if (!fallbackIndex[number].stops.some(s => s.id === stopId)) {
                    fallbackIndex[number].stops.push({ id: stopId, name: stopLabel });
                }
            });
        } catch (err) {
            console.error("Erreur fallback arrêt " + stopId + " :", err);
        }
    }));

    if (Object.keys(fallbackIndex).length === 0) return false;

    linesIndex = fallbackIndex;
    return true;
}

async function forceLinesRescan() {
    await buildLinesIndex();
}

// Construit l'index de toutes les lignes du réseau à partir d'un seul fetch
// du geojson officiel Naolib (arrêts + linked_lines + GPS, réseau entier).
// Sauvegarde le résultat en local pour éviter de tout refaire à chaque
// ouverture — voir initTransportLines() pour la logique de cache/rescan.
// En cas d'échec (fichier renommé/supprimé côté Naolib, etc.), on NE touche
// PAS au cache existant : on garde les dernières données valides connues au
// lieu de les remplacer par du vide, et on ne marque jamais un échec comme
// "à jour" (sinon plus aucun rescan ne serait retenté avant 30 jours).
async function buildLinesIndex() {
    const select = document.getElementById("new-transport-line");
    if (select) {
        select.innerHTML = `<option value="">🔄 Analyse des lignes en cours...</option>`;
        select.disabled = true;
    }
    showLinesCacheInfo(null, true);

    const t0 = performance.now();
    console.time("buildLinesIndex");

    let freshIndex = {};
    let success = false;

    try {
        const res = await fetch(NAOLIB_GEOJSON_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const geo = await res.json();
        if (!Array.isArray(geo.features) || geo.features.length === 0) {
            throw new Error("Réponse vide ou format inattendu");
        }

        const seenStopIds = {}; // un arrêt logique peut avoir plusieurs points (quais) ; on n'en garde qu'un

        geo.features.forEach(feature => {
            const p = feature.properties || {};
            const stopId = p.id;
            if (seenStopIds[stopId]) return;
            seenStopIds[stopId] = true;

            const lineNumbers = String(p.linked_lines || "").split(";").map(s => s.trim()).filter(Boolean);
            lineNumbers.forEach(number => {
                if (!freshIndex[number]) {
                    freshIndex[number] = { id: number, number, stops: [] };
                }
                freshIndex[number].stops.push({ id: stopId, name: p.name, lat: p.lat, lng: p.lng });
            });
        });

        Object.values(freshIndex).forEach(line => {
            line.stops = sortStopsByProximity(line.stops);
        });

        success = true;
    } catch (err) {
        console.error("Erreur chargement logical_stops.geojson :", err);
    }

    const elapsedMs = Math.round(performance.now() - t0);
    console.timeEnd("buildLinesIndex");

    if (success) {
        linesIndex = freshIndex;
        console.log(`Analyse des lignes terminée en ${elapsedMs} ms (${Object.keys(linesIndex).length} lignes, réseau entier)`);
        populateTransportLineSelect();
        saveLinesIndexToCache();
        showLinesCacheInfo(Date.now(), false, elapsedMs);
    } else {
        // On garde le cache existant tel quel s'il y en a un
        const cached = loadCachedLinesIndex();
        if (cached) {
            linesIndex = cached.index;
            populateTransportLineSelect();
            showLinesFetchError(cached.builtAt, false);
        } else {
            // Pas de cache du tout : dernier recours, mode restreint via l'API
            // sur les seuls arrêts déjà configurés
            const restrictedOk = await buildLinesIndexFallbackFromRoutes();
            populateTransportLineSelect();
            showLinesFetchError(null, restrictedOk);
        }
    }
}

// Point d'entrée : utilise le cache local s'il existe (affichage instantané),
// et ne relance une analyse complète que si le cache est absent ou a plus de
// 30 jours (pour repérer d'éventuelles nouvelles lignes/arrêts).
async function initTransportLines() {
    const cached = loadCachedLinesIndex();
    const isFresh = cached && (Date.now() - cached.builtAt) < LINES_CACHE_MAX_AGE;

    if (cached) {
        linesIndex = cached.index;
        populateTransportLineSelect();
        showLinesCacheInfo(cached.builtAt, false);
    }

    if (isFresh) return; // cache récent : rien d'autre à faire

    await buildLinesIndex();
}

function populateTransportLineSelect() {
    const select = document.getElementById("new-transport-line");
    if (!select) return;

    const lines = Object.values(linesIndex).sort((a, b) =>
        String(a.number).localeCompare(String(b.number), undefined, { numeric: true })
    );

    if (lines.length === 0) {
        select.innerHTML = `<option value="">Aucune ligne disponible</option>`;
        return;
    }

    select.innerHTML = `<option value="">Choisir une ligne...</option>` +
        lines.map(l => `<option value="${l.id}" style="color:${lineColor(l.number)}">Ligne ${l.number}</option>`).join("");
    select.disabled = false;
}

// Ligne choisie → propose tous les arrêts du réseau desservis par cette ligne,
// triés par proximité GPS (approxime l'ordre de passage)
function onTransportLineChange() {
    const lineId = document.getElementById("new-transport-line").value;
    const stopSelect = document.getElementById("new-transport-stop");
    const dirSelect  = document.getElementById("new-transport-direction");

    stopSelect.innerHTML = `<option value="">— Arrêt —</option>`;
    dirSelect.innerHTML  = `<option value="">— Direction —</option>`;
    stopSelect.disabled = true;
    dirSelect.disabled  = true;

    if (!lineId) return;
    const line = linesIndex[lineId];
    if (!line) return;

    stopSelect.innerHTML = `<option value="">— Arrêt —</option>` +
        line.stops.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
    stopSelect.disabled = false;
}

// Arrêt choisi (pour la ligne déjà sélectionnée) → interroge l'API pour cet
// arrêt précis afin de récupérer ses directions (le geojson ne les donne pas)
async function onTransportStopChange() {
    const lineId = document.getElementById("new-transport-line").value;
    const stopId = document.getElementById("new-transport-stop").value;
    const dirSelect = document.getElementById("new-transport-direction");

    dirSelect.innerHTML = `<option value="">— Direction —</option>`;
    dirSelect.disabled = true;

    if (!lineId || !stopId) return;

    dirSelect.innerHTML = `<option value="">Chargement...</option>`;

    try {
        const data = await fetchNaolibStop(stopId);
        const line = (data.linked_lines || []).find(l => String(l.id) === String(lineId) || String(l.number) === String(lineId));

        if (!line) {
            dirSelect.innerHTML = `<option value="">— Direction —</option>`;
            return;
        }

        dirSelect.innerHTML = `<option value="">— Direction —</option>` +
            (line.directions || []).map(d => `<option value="${d.direction}">${d.name}</option>`).join("");
        dirSelect.disabled = false;
    } catch (err) {
        console.error("Erreur chargement direction :", err);
        dirSelect.innerHTML = `<option value="">⚠️ Erreur de chargement</option>`;
    }
}

// Palette tournante déterministe (pas les vraies couleurs officielles TAN,
// juste de quoi distinguer visuellement les lignes que tu ajoutes)
// Couleurs officielles issues du GTFS Naolib (routes.txt / route_color).
// 108 lignes couvertes. Fallback par hash pour toute ligne absente de cette table
// (ex : nouvelle ligne créée après la dernière mise à jour du GTFS).
const OFFICIAL_LINE_COLORS = {
    "1": "#00a754",
    "2": "#e30613",
    "3": "#2581c4",
    "4": "#ffcd1c",
    "5": "#0bbbef",
    "10": "#ffed00",
    "11": "#e8b975",
    "12": "#a1daf8",
    "23": "#0bbbef",
    "26": "#009640",
    "27": "#a1daf8",
    "28": "#a1daf8",
    "30": "#ffed00",
    "33": "#f5b5d3",
    "36": "#65c2c4",
    "38": "#009640",
    "40": "#ffed00",
    "42": "#c8d300",
    "47": "#bca3ce",
    "50": "#ffed00",
    "59": "#f5b5d3",
    "60": "#ffed00",
    "66": "#2581c4",
    "67": "#2581c4",
    "69": "#d39e46",
    "71": "#c8d300",
    "75": "#e8b975",
    "77": "#a1daf8",
    "78": "#f7a600",
    "79": "#f5b5d3",
    "80": "#ffed00",
    "81": "#65c2c4",
    "85": "#f5b5d3",
    "86": "#0bbbef",
    "87": "#f7a600",
    "88": "#a877b2",
    "89": "#76b82a",
    "91": "#009640",
    "93": "#65c2c4",
    "95": "#c8d300",
    "96": "#f7a600",
    "97": "#bca3ce",
    "98": "#f7a600",
    "101": "#a9162e",
    "102": "#a9162e",
    "104": "#a9162e",
    "105": "#a9162e",
    "107": "#a9162e",
    "108": "#a9162e",
    "109": "#a9162e",
    "111": "#a9162e",
    "112": "#a9162e",
    "115": "#a9162e",
    "117": "#a9162e",
    "118": "#a9162e",
    "119": "#a9162e",
    "122": "#a9162e",
    "127": "#a9162e",
    "128": "#a9162e",
    "129": "#a9162e",
    "131": "#a9162e",
    "135": "#a9162e",
    "137": "#a9162e",
    "138": "#a9162e",
    "139": "#a9162e",
    "141": "#a9162e",
    "142": "#a9162e",
    "147": "#a9162e",
    "149": "#a9162e",
    "152": "#a9162e",
    "157": "#a9162e",
    "158": "#a9162e",
    "159": "#a9162e",
    "162": "#a9162e",
    "168": "#a9162e",
    "169": "#a9162e",
    "172": "#a9162e",
    "179": "#a9162e",
    "189": "#a9162e",
    "192": "#a9162e",
    "1B": "#00a754",
    "C1": "#0bbbef",
    "C2": "#ee7402",
    "C20": "#ffed00",
    "C3": "#f7a600",
    "C4": "#76b82a",
    "C6": "#a877b2",
    "C7": "#c8d300",
    "C8": "#c8d300",
    "C9": "#f5b5d3",
    "E1": "#e30613",
    "E4": "#e30613",
    "E5": "#e30613",
    "E8": "#e30613",
    "LCE": "#00a754",
    "LCN": "#e30613",
    "LCO": "#2581c4",
    "N1": "#2aaab6",
    "N2": "#2aaab6",
    "N3": "#2aaab6",
    "NA": "#a1daf8",
    "NC": "#ffffff",
    "NGG": "#2581c4",
    "NN": "#f91aff",
    "NO": "#fffa3e",
    "NS": "#00ffc2",
    "TE1": "#502391",
    "TE2": "#2581c4"
};

function lineColor(lineNumber) {
    const key = String(lineNumber).trim();
    if (OFFICIAL_LINE_COLORS[key]) return OFFICIAL_LINE_COLORS[key];

    const palette = ["#e2001a", "#0069e2", "#f59e0b", "#22c55e", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];
    let hash = 0;
    for (const ch of String(lineNumber)) hash = (hash * 31 + ch.charCodeAt(0)) % palette.length;
    return palette[Math.abs(hash) % palette.length];
}

function addTransportRoute() {
    const stopSelect = document.getElementById("new-transport-stop");
    const lineSelect = document.getElementById("new-transport-line");
    const dirSelect  = document.getElementById("new-transport-direction");

    const stopId    = stopSelect.value;
    const lineId    = lineSelect.value;
    const direction = dirSelect.value;

    if (!stopId || !lineId || !direction) return;

    const stopLabel  = stopSelect.options[stopSelect.selectedIndex].textContent;
    const lineNumber = lineId; // la valeur du select EST le numéro de ligne (ex: "3", "C8")
    const destLabel  = dirSelect.options[dirSelect.selectedIndex].textContent;

    const routes = getTransportRoutes();
    routes.push({
        id: Date.now().toString(),
        stopId, stopLabel,
        lineId, lineNumber,
        direction, destLabel,
        color: lineColor(lineNumber)
    });
    saveTransportRoutes(routes);

    renderTransportRoutesList();
    updateTransports();

    // Reset des selects pour un prochain ajout (on garde la liste des lignes chargée)
    lineSelect.value = "";
    stopSelect.innerHTML = `<option value="">— Arrêt —</option>`;
    stopSelect.disabled = true;
    dirSelect.innerHTML = `<option value="">— Direction —</option>`;
    dirSelect.disabled = true;
}

function removeTransportRoute(id) {
    saveTransportRoutes(getTransportRoutes().filter(r => r.id !== id));
    renderTransportRoutesList();
    updateTransports();
}

function renderTransportRoutesList() {
    const container = document.getElementById("transport-routes-list");
    if (!container) return;

    const routes = getTransportRoutes();

    if (routes.length === 0) {
        container.innerHTML = `<p style="color:#94a3b8;padding:10px 0;">Aucune ligne configurée pour l'instant.</p>`;
        return;
    }

    container.innerHTML = "";
    routes.forEach(r => {
        const row = document.createElement("div");
        row.className = "transport-route-item";
        row.innerHTML = `
            <span class="line-badge" style="background:${r.color};color:white">${r.lineNumber}</span>
            <span class="transport-route-label">${r.destLabel} <span class="transport-route-stop">(${r.stopLabel})</span></span>
            <button class="phone-remove" onclick="removeTransportRoute('${r.id}')" aria-label="Supprimer cette ligne des favoris">${ICON_X}</button>
        `;
        container.appendChild(row);
    });
}

// ─── Icônes (style Tabler, traits fins, héritent de la couleur du texte) ────
const ICON_BUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M6 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M18 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M4 17h-2v-11a1 1 0 0 1 1 -1h14a5 7 0 0 1 5 7v5h-2m-4 0h-8" /><path d="M16 5l1.5 7l4.5 0" /><path d="M2 10l15 0" /><path d="M7 5l0 5" /><path d="M12 5l0 5" /></svg>`;

const ICON_MAP_PIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-sm"><path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z" /></svg>`;

const ICON_ALERT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M12 9v4" /><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.535a1.914 1.914 0 0 0 -3.274 0z" /><path d="M12 16h.01" /></svg>`;

const ICON_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>`;

const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M5 12l5 5l10 -10" /></svg>`;

const ICON_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-btn"><path d="M18 6l-12 12" /><path d="M6 6l12 12" /></svg>`;

const ICON_CLOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path d="M12 7v5l3 3" /></svg>`;

const ICON_SETTINGS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" /><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /></svg>`;

const ICON_STAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" /></svg>`;

const ICON_STAR_FILLED = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M8.243 7.34l-6.38 .925l-.113 .023a1 1 0 0 0 -.44 1.684l4.622 4.499l-1.09 6.355l-.013 .11a1 1 0 0 0 1.464 .944l5.706 -3l5.693 3l.1 .046a1 1 0 0 0 1.352 -1.1l-1.091 -6.355l4.624 -4.5l.078 -.085a1 1 0 0 0 -.633 -1.62l-6.38 -.926l-2.852 -5.78a1 1 0 0 0 -1.794 0l-2.853 5.78z" /></svg>`;

// Jeu d'icônes batterie — une par palier de charge, + charge en cours et déconnecté
const ICON_BATTERY_0  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M6 7h11a2 2 0 0 1 2 2v.5a.5 .5 0 0 0 .5 .5a.5 .5 0 0 1 .5 .5v3a.5 .5 0 0 1 -.5 .5a.5 .5 0 0 0 -.5 .5v.5a2 2 0 0 1 -2 2h-11a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2" /></svg>`;
const ICON_BATTERY_25 = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M6 7h11a2 2 0 0 1 2 2v.5a.5 .5 0 0 0 .5 .5a.5 .5 0 0 1 .5 .5v3a.5 .5 0 0 1 -.5 .5a.5 .5 0 0 0 -.5 .5v.5a2 2 0 0 1 -2 2h-11a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2" /><path d="M7 10l0 4" /></svg>`;
const ICON_BATTERY_50 = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M6 7h11a2 2 0 0 1 2 2v.5a.5 .5 0 0 0 .5 .5a.5 .5 0 0 1 .5 .5v3a.5 .5 0 0 1 -.5 .5a.5 .5 0 0 0 -.5 .5v.5a2 2 0 0 1 -2 2h-11a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2" /><path d="M7 10l0 4" /><path d="M10 10l0 4" /></svg>`;
const ICON_BATTERY_75 = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M6 7h11a2 2 0 0 1 2 2v.5a.5 .5 0 0 0 .5 .5a.5 .5 0 0 1 .5 .5v3a.5 .5 0 0 1 -.5 .5a.5 .5 0 0 0 -.5 .5v.5a2 2 0 0 1 -2 2h-11a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2" /><path d="M7 10l0 4" /><path d="M10 10l0 4" /><path d="M13 10l0 4" /></svg>`;
const ICON_BATTERY_100 = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M6 7h11a2 2 0 0 1 2 2v.5a.5 .5 0 0 0 .5 .5a.5 .5 0 0 1 .5 .5v3a.5 .5 0 0 1 -.5 .5a.5 .5 0 0 0 -.5 .5v.5a2 2 0 0 1 -2 2h-11a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2" /><path d="M7 10l0 4" /><path d="M10 10l0 4" /><path d="M13 10l0 4" /><path d="M16 10l0 4" /></svg>`;
const ICON_BATTERY_CHARGING = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M16 7h1a2 2 0 0 1 2 2v.5a.5 .5 0 0 0 .5 .5a.5 .5 0 0 1 .5 .5v3a.5 .5 0 0 1 -.5 .5a.5 .5 0 0 0 -.5 .5v.5a2 2 0 0 1 -2 2h-2" /><path d="M8 7h-2a2 2 0 0 0 -2 2v6a2 2 0 0 0 2 2h1" /><path d="M12 8l-2 4h3l-2 4" /></svg>`;
const ICON_BATTERY_UNAVAILABLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M9 17h8c1.105 0 2 -.895 2 -2v-.5c0 -.276 .224 -.5 .5 -.5s.5 -.224 .5 -.5v-3c0 -.276 -.224 -.5 -.5 -.5s-.5 -.224 -.5 -.5v-.5c0 -1.105 -.895 -2 -2 -2h-11c-1.105 0 -2 .895 -2 2v3" /><path d="M5 16v3" /><path d="M5 22v.01" /></svg>`;

// Choisit l'icône adaptée au niveau (et à l'état de charge) d'une batterie
function batteryIconFor(level, isCharging) {
    if (level === null) return ICON_BATTERY_UNAVAILABLE;
    if (isCharging) return ICON_BATTERY_CHARGING;
    if (level <= 5) return ICON_BATTERY_0;
    if (level <= 25) return ICON_BATTERY_25;
    if (level <= 50) return ICON_BATTERY_50;
    if (level <= 75) return ICON_BATTERY_75;
    return ICON_BATTERY_100;
}

const ICON_DEVICE_TV = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M3 7m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" /><path d="M16 3l-4 4l-4 -4" /></svg>`;

const ICON_MUSIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path d="M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path d="M9 17v-13h10v13" /><path d="M9 8h10" /></svg>`;

const ICON_DEVICE_DESKTOP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-lg"><path d="M3 4m0 1a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1z" /><path d="M7 20h10" /><path d="M9 16v4" /><path d="M15 16v4" /></svg>`;

function updateTransportWidgetTitle() {
    const routes = getTransportRoutes();
    const titleEl      = document.getElementById("transport-title");
    const titleModalEl = document.getElementById("transport-title-modal");

    let label = "Transport";
    if (routes.length > 0) {
        const uniqueStops = [...new Set(routes.map(r => r.stopLabel))];
        label = uniqueStops.length === 1 ? uniqueStops[0] : "Transport";
    }

    // Tuile : titre dynamique (un seul groupe visible à la fois, pas de redondance)
    if (titleEl) titleEl.innerHTML = `${ICON_BUS} ${label}`;
    // Popup : titre générique — chaque groupe d'arrêt a déjà son propre en-tête
    if (titleModalEl) titleModalEl.innerHTML = `${ICON_BUS} Transport`;
}

// ─── Transports : icône temps réel (remplace le 🟢/⚪) ───────────────────────
// SVG fourni par Steve (icon_rt.svg) — 2 arcs avec animation d'opacité en
// cascade façon "signal". L'animation elle-même est définie une seule fois
// dans style.css (.rt-arc-a / .rt-arc-b) et partagée par toutes les cartes,
// au lieu d'un jeu de @keyframes unique par instance — moins de travail pour
// le navigateur quand plusieurs cartes temps réel sont affichées à la fois.
function rtIconSVG() {
    return `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
        <path class="rt-arc-a" d="M263.4,282c-10.3,0-18.6-8.3-18.6-18.6c0-114.8-93.4-208.2-208.2-208.2C26.3,55.2,18,46.9,18,36.6s8.3-18.6,18.6-18.6C171.9,18,282,128.1,282,263.4c0,10.3-8.3,18.6-18.6,18.6Z" fill="currentColor"/>
        <path class="rt-arc-b" d="M192.8,282c-10.3,0-18.6-8.3-18.6-18.6c0-75.9-61.7-137.6-137.6-137.6-10.3,0-18.6-8.3-18.6-18.6s8.3-18.6,18.6-18.6c96.4,0,174.8,78.4,174.8,174.8c0,10.3-8.4,18.6-18.6,18.6Z" fill="currentColor"/>
    </svg>`;
}

// Position visuelle volontairement estimée : l'API Naolib utilisée ici fournit
// l'horaire du prochain passage, mais aucune coordonnée GPS du véhicule. La
// barre rend l'approche plus lisible, jamais ne localise réellement le bus.
function estimatedApproachProgress(label) {
    if (label === "À quai") return 96;
    const minutes = Number.parseInt(label, 10);
    if (!Number.isFinite(minutes)) return 18;
    // Fenêtre d'approche de 15 min : plus l'arrivée est proche, plus le bus se
    // rapproche visuellement de l'arrêt. Bornes pour rester lisible.
    return Math.round(Math.max(18, Math.min(88, 18 + ((15 - Math.min(minutes, 15)) / 15) * 70)));
}

function busIconSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
        <path d="M18 17m-2 0a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
        <path d="M4 17h-2v-11a1 1 0 0 1 1 -1h14a5 7 0 0 1 5 7v5h-2m-4 0h-8" />
        <path d="M16 5l1.5 7l4.5 0" /><path d="M2 10l15 0" />
    </svg>`;
}

function transportEscapeHTML(value) {
    const el = document.createElement("span");
    el.textContent = value || "";
    return el.innerHTML;
}

function normalizeTransportName(value) {
    return String(value || "").toLocaleLowerCase("fr-FR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function transportNameMatches(name, normalizedNeedle) {
    if (!normalizedNeedle) return false;
    const normalizedName = normalizeTransportName(name);
    return normalizedName === normalizedNeedle || normalizedName.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedName);
}

// Résout, pour une ligne + destination, la séquence d'arrêts GTFS (déjà dans
// le bon sens de trajet) et l'index du "targetStop" dans cette séquence.
// Factorisé car utilisé à la fois pour choisir les arrêts à interroger en
// amont (getApproachCandidateStopIds) et pour construire la fenêtre affichée
// (getEstimatedApproachStops).
function resolveGtfsRouteWindow(lineNumber, destLabel, targetStopLabel) {
    const gtfsDirections = naolibStopOrder?.[lineNumber];
    const destinationNorm = normalizeTransportName(destLabel);
    if (!gtfsDirections || !destinationNorm) return null;

    const directionEntry = gtfsDirections.find(d => transportNameMatches(d.headsign, destinationNorm));
    const orderedStops = directionEntry?.stops || [];
    const targetIndex = orderedStops.findIndex(name => transportNameMatches(name, normalizeTransportName(targetStopLabel)));
    if (targetIndex < 0 || orderedStops.length < 2) return null;

    return { orderedStops, targetIndex };
}

// Construit, pour une route donnée (ligne + arrêt + direction favorite), la
// table nom d'arrêt -> stopId de l'appli (via linesIndex, issu du geojson)
// afin de pouvoir interroger l'API temps réel de n'importe quel arrêt de la
// séquence GTFS (qui ne connaît que des noms, pas les id internes Naolib).
function buildStopNameToIdMap(lineNumber) {
    const map = new Map();
    (linesIndex[lineNumber]?.stops || []).forEach(s => {
        const norm = normalizeTransportName(s.name);
        if (!map.has(norm)) map.set(norm, s.id);
    });
    return map;
}

const APPROACH_LOCATE_WINDOW = 8; // nb d'arrêts précédents interrogés pour localiser le véhicule

// Arrêts à interroger EN PLUS du tien pour localiser le véhicule sur cette
// route (voir getEstimatedApproachStops) — à ajouter au fetch groupé de
// updateTransports() avant le rendu, pour rester dans le même lot de
// requêtes plutôt que d'en déclencher de nouvelles pendant le rendu.
function getApproachCandidateStopIds(route) {
    const window_ = resolveGtfsRouteWindow(route.lineNumber, route.destLabel, route.stopLabel);
    if (!window_) return [];
    const { orderedStops, targetIndex } = window_;
    const nameToId = buildStopNameToIdMap(route.lineNumber);

    const ids = [];
    for (let i = Math.max(0, targetIndex - APPROACH_LOCATE_WINDOW); i < targetIndex; i++) {
        const id = nameToId.get(normalizeTransportName(orderedStops[i]));
        if (id) ids.push(id);
    }
    return ids;
}

// Reconstruit la fenêtre de 7 arrêts autour du véhicule pour la barre
// "Approche estimée". Localise le véhicule de deux façons, par ordre de
// préférence :
//  1. Temps réel : on regarde, parmi les arrêts précédant le tien sur le
//     même trajet (déjà récupérés dans stopDataById par updateTransports),
//     lequel a l'horaire le plus proche — mais AVANT l'heure de passage
//     prévue à ton arrêt — pour éviter de confondre notre bus avec le
//     suivant sur les lignes à fréquence élevée.
//  2. Repli : estimation par interpolation temporelle (% du temps d'attente
//     écoulé), utilisée si le temps réel amont n'est pas exploitable.
// Si aucune donnée GTFS n'est disponible pour la ligne/direction, retombe
// entièrement sur l'ancienne estimation par proximité GPS.
function getEstimatedApproachStops(card, dir, progress, stopDataById, targetTimeHHMM) {
    // Design "C" (liste verticale) : moins d'arrêts affichés à la fois qu'en
    // horizontal (l'espace vertical de la popup est plus contraint), 2 avant
    // + l'arrêt courant + 2 après suffisent à montrer la progression.
    const centerIndex = 2;
    const stopCount = 5;
    const approachLength = 6;
    const travelled = Math.max(0, Math.min(approachLength, Math.round((progress / 100) * approachLength)));
    const destinationNorm = normalizeTransportName(dir?.destLabel);

    const window_ = resolveGtfsRouteWindow(card.lineNumber, dir?.destLabel, card.stopLabel);
    if (window_) {
        const { orderedStops, targetIndex } = window_;
        // Repli par défaut si le temps réel amont n'apporte rien.
        let vehicleLineIndex = targetIndex - (approachLength - travelled);

        if (stopDataById && targetTimeHHMM) {
            const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
            const toAbsMin = hhmm => {
                const [h, m] = hhmm.split(":").map(Number);
                let total = h * 60 + m;
                if (total < nowMin - 120) total += 24 * 60; // passage minuit
                return total;
            };
            const targetMin = toAbsMin(targetTimeHHMM);
            const nameToId = buildStopNameToIdMap(card.lineNumber);

            let bestIndex = null;
            let bestMin = -Infinity; // le plus proche AVANT targetMin
            for (let i = Math.max(0, targetIndex - APPROACH_LOCATE_WINDOW); i < targetIndex; i++) {
                const id = nameToId.get(normalizeTransportName(orderedStops[i]));
                if (!id) continue;
                const first = stopDataById[id]?.departures?.[card.lineNumber]?.[card.direction]?.hours?.[0];
                if (!first) continue;
                const t = toAbsMin(first.time);
                // On ne garde que les passages antérieurs au tien : un arrêt
                // déjà dépassé par notre bus affiche le PROCHAIN passage (donc
                // potentiellement après le tien si la fréquence est élevée) —
                // l'ignorer évite de le prendre pour la position actuelle.
                if (t < targetMin && t > bestMin) { bestMin = t; bestIndex = i; }
            }
            if (bestIndex !== null) vehicleLineIndex = bestIndex;
        }

        const stops = Array.from({ length: stopCount }, (_, index) => {
            const name = orderedStops[vehicleLineIndex + (index - centerIndex)];
            return name ? { name } : null;
        });
        return { stops, vehicleIndex: centerIndex };
    }

    // ─── Repli : ancienne estimation GPS ────────────────────────────────
    const lineStops = linesIndex[card.lineNumber]?.stops || [];
    const targetIndex = lineStops.findIndex(stop => String(stop.id) === String(card.stopId));
    if (targetIndex < 0 || lineStops.length < 2) return { stops: [], vehicleIndex: centerIndex };

    const destinationIndex = lineStops.findIndex(stop => transportNameMatches(stop.name, destinationNorm));
    // Sans terminus identifiable, le sens de parcours ne peut pas être établi
    // de façon fiable avec les seules données locales : on affiche la barre
    // simple, plutôt que des arrêts potentiellement erronés.
    if (destinationIndex < 0) return { stops: [], vehicleIndex: centerIndex };
    const step = destinationIndex < targetIndex ? -1 : 1;
    const vehicleLineIndex = targetIndex - (approachLength - travelled) * step;
    const stops = Array.from({ length: stopCount }, (_, index) =>
        lineStops[vehicleLineIndex + (index - centerIndex) * step] || null
    );

    // Position estimée par l'horaire : aucune position GPS n'est fournie.
    return { stops, vehicleIndex: centerIndex };
}

// Version compacte pour l'accueil : le bus suit une progression estimée mais
// sans texte additionnel afin de conserver des cartes d'horaires lisibles.
function updateEstimatedApproach(el, card, entry) {
    const existing = el.querySelector(".transport-estimated-approach");
    if (!entry) {
        existing?.remove();
        el.classList.remove("has-estimated-approach");
        return;
    }

    const progress = estimatedApproachProgress(entry.label);
    const approach = existing || document.createElement("div");
    approach.className = "transport-estimated-approach";
    approach.setAttribute("aria-label", "Approche estimée de l'arrêt : " + entry.label);
    approach.innerHTML = `
        <div class="transport-estimated-track">
            <span class="transport-estimated-fill" style="width:${progress}%"></span>
            <span class="transport-estimated-bus" style="left:${progress}%">${busIconSVG()}</span>
        </div>
    `;
    if (!existing) el.appendChild(approach);
    el.classList.add("has-estimated-approach");
}

function createEstimatedApproachRow(entry, card, stopDataById) {
    if (!entry) return null;

    const progress = estimatedApproachProgress(entry.label);
    const row = document.createElement("div");
    row.className = "transport-estimated-approach-row";
    row.style.setProperty("--transport-line-color", card.color);
    row.setAttribute("aria-label", "Approche estimée de l'arrêt : " + entry.label);
    const route = getEstimatedApproachStops(card, { destLabel: card.destLabel }, progress, stopDataById, entry?.time);
    const colorStyle = `style="--transport-line-color:${card.color}"`;
    // Liste verticale (design "C") : on ne garde que les arrêts réellement
    // résolus (les cases vides en bord de fenêtre sont simplement omises,
    // pas besoin de les préserver comme avec une grille à colonnes fixes).
    const items = route.stops
        .map((stop, index) => ({ stop, isVehicle: index === route.vehicleIndex, isPassed: index < route.vehicleIndex }))
        .filter(it => it.stop);
    row.innerHTML = items.length ? `
        <div class="transport-estimated-stops transport-estimated-popup-stops" ${colorStyle}>
            ${items.map((it, i) => {
                const connector = i > 0
                    ? `<span class="transport-estimated-connector ${(items[i - 1].isPassed || items[i - 1].isVehicle) ? "passed" : ""}"></span>`
                    : "";
                const rowClass = it.isVehicle ? "vehicle-stop" : (it.isPassed ? "passed" : "");
                const marker = it.isVehicle
                    ? `<span class="transport-estimated-marker"><span class="transport-estimated-vehicle-icon">${busIconSVG()}</span></span>`
                    : `<span class="transport-estimated-marker"><span class="transport-estimated-dot"></span></span>`;
                return `${connector}<div class="transport-estimated-stop ${rowClass}">${marker}<span class="transport-estimated-stop-name">${transportEscapeHTML(it.stop.name)}</span></div>`;
            }).join("")}
        </div>
        <span class="transport-estimated-row-label">Approche estimée · votre arrêt dans ${entry.label}</span>
    ` : `
        <span class="transport-estimated-row-label">Approche estimée</span>
        <div class="transport-estimated-row-track" ${colorStyle}>
            <span class="transport-estimated-row-fill" style="width:${progress}%"></span>
            <span class="transport-estimated-row-bus" style="left:${progress}%">${busIconSVG()}</span>
        </div>
        <span class="transport-estimated-row-arrival">Votre arrêt · ${entry.label}</span>
    `;
    return row;
}

// ─── Transports : carrousel de cartes ────────────────────────────────────────
// Une carte = une ligne à un arrêt configuré. Swipe horizontal (natif, scroll-
// snap) = change de carte/ligne. Swipe vertical (custom, par carte) = change
// de direction pour CETTE ligne, si plusieurs directions ont été configurées.
// La tuile d'accueil et la popup partagent le même état (direction choisie,
// carte active) pour rester synchronisées.

let transportCardsByKey = {};        // cardKey -> objet carte (partagé tuile/popup)
const transportDirectionIndex = {};  // cardKey -> index de direction actif
const transportActiveCard = { home: 0, modal: 0 }; // index de carte centrée par instance

function formatCardValue(label) {
    if (!label) return { big: "—", unit: "" };
    if (label === "À quai") return { big: "À quai", unit: "" };
    const m = label.match(/^(\d+)\s*min$/);
    if (m) return { big: m[1], unit: "min" };
    return { big: label, unit: "" }; // format hh:mm (passage dans plus d'1h)
}

// Regroupe les routes configurées par (arrêt, ligne) → une carte par groupe,
// chaque carte pouvant contenir plusieurs directions (une par route ajoutée
// avec ce même arrêt+ligne mais une direction différente).
function buildTransportCards(routes, stopDataById, toMin, nowMin, waitLabel) {
    const order = [];
    const byKey = {};

    routes.forEach(r => {
        const key = r.stopId + "__" + r.lineNumber;
        if (!byKey[key]) {
            byKey[key] = { key, stopId: r.stopId, stopLabel: r.stopLabel, lineNumber: r.lineNumber, color: r.color, directions: [] };
            order.push(key);
        }
        if (byKey[key].directions.some(d => d.direction === r.direction)) return; // évite les doublons

        const data  = stopDataById[r.stopId];
        const hours = data?.departures?.[r.lineNumber]?.[r.direction]?.hours || [];
        const next  = hours.filter(h => toMin(h.time) > nowMin);

        byKey[key].directions.push({
            direction: r.direction,
            destLabel: r.destLabel,
            entries: next.map(h => ({ label: waitLabel(h.time), isRt: !!h.is_rt }))
        });
    });

    return order.map(k => byKey[k]);
}

function updateTransportHeaderEl(headerEl, cards, activeIdx) {
    if (!headerEl) return;

    const card = cards[activeIdx];
    if (!card) { headerEl.textContent = ""; return; }

    const dirIdx = transportDirectionIndex[card.key] || 0;
    const dir = card.directions[dirIdx];
    headerEl.innerHTML = `${card.stopLabel} <span class="arrow">⟷</span> ${dir ? dir.destLabel : ""}`;
}

// Met à jour le contenu d'une seule carte (valeur, icône RT, compteur de
// directions) sans tout re-render — utilisé après un swipe vertical.
function updateSingleCard(el, card, dirIdx) {
    const dir = card.directions[dirIdx];
    const entry = dir.entries[0];
    const { big, unit } = formatCardValue(entry ? entry.label : null);

    el.querySelector(".transport-card-value").textContent = big;
    el.querySelector(".transport-card-unit").textContent = unit;

    let rtHolder = el.querySelector(".transport-card-rt");
    if (entry && entry.isRt) {
        if (!rtHolder) {
            rtHolder = document.createElement("span");
            rtHolder.className = "transport-card-rt";
            el.appendChild(rtHolder);
        }
        rtHolder.innerHTML = rtIconSVG();
    } else if (rtHolder) {
        rtHolder.remove();
    }

    const countEl = el.querySelector(".transport-card-dircount");
    if (countEl) countEl.textContent = `${dirIdx + 1}/${card.directions.length}`;

    updateEstimatedApproach(el, card, entry);
}

function mirrorCardDirection(cardKey, dirIdx) {
    const card = transportCardsByKey[cardKey];
    if (!card) return;
    document.querySelectorAll(`.transport-card-item[data-card-key="${cardKey}"]`).forEach(el => {
        updateSingleCard(el, card, dirIdx);
    });
}

function attachCardVerticalSwipe(el, card, instanceKey, headerEl, cards) {
    if (card.directions.length <= 1) return; // rien à swiper

    let startY = 0, startX = 0, dragging = false, moved = false;

    el.addEventListener("pointerdown", (e) => {
        startY = e.clientY;
        startX = e.clientX;
        dragging = true;
        moved = false;
        el.classList.add("dragging");
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });

    el.addEventListener("pointermove", (e) => {
        if (!dragging || moved) return;
        const dy = e.clientY - startY;
        const dx = e.clientX - startX;
        if (Math.abs(dy) > 28 && Math.abs(dy) > Math.abs(dx)) {
            moved = true;
            const step = dy < 0 ? 1 : -1; // vers le haut = direction suivante
            const newIdx = (transportDirectionIndex[card.key] + step + card.directions.length) % card.directions.length;
            transportDirectionIndex[card.key] = newIdx;

            updateSingleCard(el, card, newIdx);
            mirrorCardDirection(card.key, newIdx);

            if (transportActiveCard[instanceKey] != null && cards[transportActiveCard[instanceKey]] === card) {
                updateTransportHeaderEl(headerEl, cards, transportActiveCard[instanceKey]);
            }
        }
    });

    const end = (e) => {
        dragging = false;
        el.classList.remove("dragging");
        try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);

    // Empêche l'ouverture de la popup (tuile d'accueil) si le tap était en fait un swipe
    el.addEventListener("click", (e) => {
        if (moved) {
            e.preventDefault();
            e.stopPropagation();
        }
    });
}

// Tuile d'accueil : une carte (grande) par ligne, un seul horaire visible ;
// swipe vertical pour changer de direction. Pas d'en-tête, pas de groupement.
function renderTransportTile(containerId, cards) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (cards.length === 0) {
        container.innerHTML = `<div class="transport-loading">${ICON_CLOCK} Aucun passage immédiat.</div>`;
        return;
    }

    if (transportActiveCard.home == null || transportActiveCard.home >= cards.length) {
        transportActiveCard.home = 0;
    }

    container.innerHTML = "";
    container.className = "transport-cards cards-count-" + Math.min(cards.length, 3);

    cards.forEach((card) => {
        const dirIdx = Math.min(transportDirectionIndex[card.key] || 0, card.directions.length - 1);
        transportDirectionIndex[card.key] = dirIdx;
        const dir = card.directions[dirIdx];
        const entry = dir.entries[0];
        const { big, unit } = formatCardValue(entry ? entry.label : null);

        const el = document.createElement("div");
        el.className = "transport-card-item";
        el.style.background = card.color;
        el.dataset.cardKey = card.key;

        el.innerHTML = `
            <span class="transport-card-line">${card.lineNumber}</span>
            <div class="transport-card-value">${big}</div>
            <div class="transport-card-unit">${unit}</div>
            ${card.directions.length > 1 ? `<span class="transport-card-dircount">${dirIdx + 1}/${card.directions.length}</span>` : ""}
        `;

        updateEstimatedApproach(el, card, entry);


        if (entry && entry.isRt) {
            const rtHolder = document.createElement("span");
            rtHolder.className = "transport-card-rt";
            rtHolder.innerHTML = rtIconSVG();
            el.appendChild(rtHolder);
        }

        attachCardVerticalSwipe(el, card, "home", null, cards);
        container.appendChild(el);
    });

    const items = container.querySelectorAll(".transport-card-item");
    if (items[transportActiveCard.home]) {
        container.scrollLeft = items[transportActiveCard.home].offsetLeft - 4;
    }
}

// ─── Popup Transport : nouvelle structure (Accueil / Favoris / Info Trafic) ──

// Assombrit une couleur hex d'un certain pourcentage (pour les mini-cartes
// des horaires suivants sur l'accueil, plus foncées que la carte principale).
function darkenColor(hex, amount = 0.35) {
    hex = String(hex).replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    if (isNaN(num)) return hex;
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    r = Math.round(r * (1 - amount));
    g = Math.round(g * (1 - amount));
    b = Math.round(b * (1 - amount));
    return `rgb(${r},${g},${b})`;
}

// Reconstruit la liste des arrêts (avec leurs lignes) à partir de linesIndex
// déjà chargé — évite un second fetch du geojson.
function getAllStopsFromLinesIndex() {
    const stopsById = {};
    Object.values(linesIndex).forEach(line => {
        line.stops.forEach(s => {
            if (!stopsById[s.id]) {
                stopsById[s.id] = { id: s.id, name: s.name, lat: s.lat, lng: s.lng, lines: [] };
            }
            stopsById[s.id].lines.push(line.number);
        });
    });
    return Object.values(stopsById);
}

// ─── Géolocalisation ──────────────────────────────────────────────────────
let userPosition = null;
let userPositionRequested = false;

const NEARBY_CACHE_KEY     = "nearby_lines_cache";
const NEARBY_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 jours avant rescan auto

let nearbyLinesCache = null; // résultat mis en cache : [{lineNumber, stopId, stopLabel, color}]

function requestUserPosition() {
    if (userPositionRequested) return Promise.resolve(userPosition);
    userPositionRequested = true;

    return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            pos => {
                userPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                resolve(userPosition);
            },
            err => {
                console.error("Géolocalisation indisponible :", err);
                resolve(null);
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60000 }
        );
    });
}

function loadCachedNearbyLines() {
    try {
        const raw = localStorage.getItem(NEARBY_CACHE_KEY);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (!cached || !cached.builtAt || !cached.lines) return null;
        return cached;
    } catch (err) {
        return null;
    }
}

function saveNearbyLinesCache(lines) {
    localStorage.setItem(NEARBY_CACHE_KEY, JSON.stringify({
        builtAt: Date.now(),
        lines
    }));
}

// Point d'entrée : sert le cache local s'il existe et a moins de 30 jours,
// sans jamais solliciter la géolocalisation dans ce cas (évite les scans à
// répétition). Ne relance une vraie localisation + recalcul que si le cache
// est absent ou périmé.
async function initNearbyLines() {
    const cached = loadCachedNearbyLines();
    const isFresh = cached && (Date.now() - cached.builtAt) < NEARBY_CACHE_MAX_AGE;

    if (cached) {
        nearbyLinesCache = cached.lines;
    }

    if (isFresh) return;

    await requestUserPosition();
    const fresh = computeNearbyLines();
    if (fresh.length > 0) {
        nearbyLinesCache = fresh;
        saveNearbyLinesCache(fresh);
    }
}

function showNearbyCacheInfo() {
    const el = document.getElementById("transport-nearby-info");
    if (!el) return;

    const cached = loadCachedNearbyLines();
    if (!cached) { el.innerHTML = ""; return; }

    const days = Math.floor((Date.now() - cached.builtAt) / (24 * 60 * 60 * 1000));
    const ago  = days <= 0 ? "aujourd'hui" : days === 1 ? "il y a 1 jour" : `il y a ${days} jours`;
    el.innerHTML = `Position analysée : ${ago} · <a href="#" onclick="forceNearbyRescan(); return false;">rescanner maintenant</a>`;
}

async function forceNearbyRescan() {
    userPositionRequested = false; // force une nouvelle lecture GPS
    await requestUserPosition();
    const fresh = computeNearbyLines();
    if (fresh.length > 0) {
        nearbyLinesCache = fresh;
        saveNearbyLinesCache(fresh);
    }
    renderNearbyGrid("transport-nearby-grid", { interactive: false, showStars: false });
    renderNearbyGrid("transport-favoris-grid", { interactive: true, showStars: true });
}

// Trouve les lignes les plus proches en partant des arrêts les plus proches
// de la position de l'utilisateur ; chaque ligne est associée à l'arrêt le
// plus proche où elle a été trouvée (utilisé pour le favoritage rapide).
function computeNearbyLines(maxLines = 10) {
    if (!userPosition) return [];
    const stops = getAllStopsFromLinesIndex();
    if (!stops.length) return [];

    const withDist = stops
        .map(s => ({ ...s, dist: haversineMeters(userPosition, { lat: s.lat, lng: s.lng }) }))
        .sort((a, b) => a.dist - b.dist);

    const seen = {};
    const result = [];

    withDist.forEach(stop => {
        stop.lines.forEach(number => {
            if (seen[number]) return;
            seen[number] = true;
            result.push({ lineNumber: number, stopId: stop.id, stopLabel: stop.name, color: lineColor(number) });
        });
    });

    return result.slice(0, maxLines);
}

// ─── Grille "Lignes à Proximités" (Accueil : informative / Favoris : cliquable) ──
function renderNearbyGrid(containerId, opts) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!nearbyLinesCache) {
        container.innerHTML = `<div class="transport-loading">Localisation en cours...</div>`;
        return;
    }

    const nearby = nearbyLinesCache;
    if (nearby.length === 0) {
        container.innerHTML = `<div class="transport-loading">Aucune ligne trouvée à proximité.</div>`;
        return;
    }

    const routes = getTransportRoutes();
    const favoriteKeys = new Set(routes.map(r => r.lineNumber + "__" + r.stopId));

    container.innerHTML = "";
    container.classList.toggle("transport-favoris-mode", !!opts.interactive);

    nearby.forEach(item => {
        const isFav = favoriteKeys.has(item.lineNumber + "__" + item.stopId);

        const badge = document.createElement("button");
        badge.className = "transport-line-badge";
        badge.style.background = item.color;
        badge.setAttribute("aria-label", `Ligne ${item.lineNumber}, arrêt ${item.stopLabel}${isFav ? " (en favoris)" : ""}`);
        badge.innerHTML = item.lineNumber +
            (opts.showStars && isFav ? `<span class="transport-line-badge-star">${ICON_STAR_FILLED}</span>` : "");

        if (opts.interactive) {
            badge.onclick = () => onNearbyLineClick(item, isFav);
        }

        container.appendChild(badge);
    });

    if (containerId === "transport-favoris-grid") showNearbyCacheInfo();
}

// ─── Favoritage rapide depuis la grille de proximité ─────────────────────
async function onNearbyLineClick(item, isFav) {
    if (isFav) {
        let routes = getTransportRoutes();
        routes = routes.filter(r => !(r.lineNumber === item.lineNumber && r.stopId === item.stopId));
        saveTransportRoutes(routes);
        renderTransportRoutesList();
        updateTransports();
        return;
    }

    let directions = [];
    try {
        const data = await fetchNaolibStop(item.stopId);
        const line = (data.linked_lines || []).find(l =>
            String(l.number) === String(item.lineNumber) || String(l.id) === String(item.lineNumber)
        );
        directions = line ? (line.directions || []) : [];
    } catch (err) {
        console.error("Erreur récupération directions :", err);
    }

    if (directions.length === 0) {
        alert("Impossible de récupérer les directions pour cette ligne pour le moment.");
        return;
    }

    showDirectionPicker(item, directions);
}

function showDirectionPicker(item, directions) {
    const overlay = document.createElement("div");
    overlay.className = "direction-picker-overlay";
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const box = document.createElement("div");
    box.className = "direction-picker-box";
    box.innerHTML = `<div class="direction-picker-title">Ligne ${item.lineNumber} — ${item.stopLabel}<br>Choisir la direction</div>`;

    directions.forEach(d => {
        const btn = document.createElement("button");
        btn.className = "direction-picker-option";
        btn.textContent = d.name;
        btn.onclick = () => {
            const routes = getTransportRoutes();
            routes.push({
                id: Date.now().toString(),
                stopId: item.stopId,
                stopLabel: item.stopLabel,
                lineNumber: item.lineNumber,
                direction: d.direction,
                destLabel: d.name,
                color: item.color
            });
            saveTransportRoutes(routes);
            renderTransportRoutesList();
            updateTransports();
            overlay.remove();
        };
        box.appendChild(btn);
    });

    const cancel = document.createElement("button");
    cancel.className = "direction-picker-cancel";
    cancel.textContent = "Annuler";
    cancel.onclick = () => overlay.remove();
    box.appendChild(cancel);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

// ─── Accueil popup : cartes des lignes favorites (grande carte + horaires
// suivants plus petits et plus foncés) ────────────────────────────────────
function renderFavoritesHomeList(routes, stopDataById, toMin, nowMin, waitLabel) {
    const container = document.getElementById("transport-favorites-list");
    if (!container) return;

    if (routes.length === 0) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = "";
    routes.forEach(r => {
        const data  = stopDataById[r.stopId];
        const hours = data?.departures?.[r.lineNumber]?.[r.direction]?.hours || [];
        const next  = hours.filter(h => toMin(h.time) > nowMin);
        const first = next[0] ? { ...next[0], label: waitLabel(next[0].time) } : null;

        const block = document.createElement("div");
        block.className = "transport-favorite-block";

        const header = document.createElement("div");
        header.className = "transport-direction-header";
        header.innerHTML = `<span class="direction-arrow">➜</span> ${r.destLabel || ""}`;
        block.appendChild(header);

        const cardsRow = document.createElement("div");
        cardsRow.className = "transport-favorite-cards";

        const { big, unit } = formatCardValue(first ? waitLabel(first.time) : null);
        const mainCard = document.createElement("div");
        mainCard.className = "transport-card-item";
        mainCard.style.background = r.color;
        mainCard.innerHTML = `
            <span class="transport-card-line">${r.lineNumber}</span>
            <div class="transport-card-value">${big}</div>
            <div class="transport-card-unit">${unit}</div>
        `;
        if (first && first.is_rt) {
            const rt = document.createElement("span");
            rt.className = "transport-card-rt";
            rt.innerHTML = rtIconSVG();
            mainCard.appendChild(rt);
        }
        cardsRow.appendChild(mainCard);

        next.slice(1, 4).forEach(h => {
            const { big: b2, unit: u2 } = formatCardValue(waitLabel(h.time));
            const mini = document.createElement("div");
            mini.className = "transport-next-mini";
            mini.style.background = darkenColor(r.color, 0.35);
            mini.innerHTML = `<div class="transport-card-value">${b2}</div><div class="transport-card-unit">${u2}</div>`;
            cardsRow.appendChild(mini);
        });

        block.appendChild(cardsRow);
        const approachRow = createEstimatedApproachRow(first, r, stopDataById);
        if (approachRow) block.appendChild(approachRow);
        container.appendChild(block);
    });
}

// ─── Navigation entre les 3 vues de la popup transport ───────────────────
function showTransportView(view) {
    ["home", "favoris", "infotrafic"].forEach(v => {
        const el = document.getElementById("transport-view-" + v);
        if (el) el.style.display = (v === view) ? "flex" : "none";
    });

    const mainClose = document.getElementById("mainModalClose");
    if (mainClose) mainClose.style.display = (view === "home") ? "" : "none";

    if (view === "infotrafic") {
        updateInfotrafic();
    } else {
        renderNearbyGrid("transport-nearby-grid", { interactive: false, showStars: false });
        renderNearbyGrid("transport-favoris-grid", { interactive: true, showStars: true });
    }
}

async function updateTransports() {
    updateTransportWidgetTitle();

    const routes = getTransportRoutes();

    const now    = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    function toMin(hhmm) {
        const [h, m] = hhmm.split(":").map(Number);
        let total = h * 60 + m;
        if (total < nowMin - 120) total += 24 * 60; // passage minuit
        return total;
    }

    function waitLabel(hhmm) {
        const diff = toMin(hhmm) - nowMin;
        if (diff <= 0)  return "À quai";
        if (diff < 60)  return `${diff} min`;
        return hhmm;
    }

    if (routes.length === 0) {
        const emptyHtml = `<div class="transport-loading">${ICON_SETTINGS} Ajoute une ligne depuis "Favoris" dans la popup.</div>`;
        const tileEl = document.getElementById("transport-list");
        if (tileEl) tileEl.innerHTML = emptyHtml;

        const favEl = document.getElementById("transport-favorites-list");
        if (favEl) favEl.innerHTML = "";

        renderNearbyGrid("transport-nearby-grid", { interactive: false, showStars: false });
        renderNearbyGrid("transport-favoris-grid", { interactive: true, showStars: true });
        return;
    }

    try {
        // Un appel API par arrêt utile — le tien pour chaque route favorite,
        // + quelques arrêts en amont sur le même trajet pour localiser
        // précisément le véhicule (voir getApproachCandidateStopIds), tous
        // dédupliqués dans le même Set pour ne pas multiplier les requêtes.
        const stopIds = new Set(routes.map(r => r.stopId));
        routes.forEach(r => getApproachCandidateStopIds(r).forEach(id => stopIds.add(id)));
        const stopDataById = {};
        await Promise.all([...stopIds].map(async id => {
            delete stopDataCache[id]; // toujours des horaires frais au refresh
            stopDataById[id] = await fetchNaolibStop(id);
        }));

        const cards = buildTransportCards(routes, stopDataById, toMin, nowMin, waitLabel);
        transportCardsByKey = {};
        cards.forEach(c => transportCardsByKey[c.key] = c);

        renderTransportTile("transport-list", cards);
        renderFavoritesHomeList(routes, stopDataById, toMin, nowMin, waitLabel);
        renderNearbyGrid("transport-nearby-grid", { interactive: false, showStars: false });
        renderNearbyGrid("transport-favoris-grid", { interactive: true, showStars: true });

    } catch (err) {
        console.error("Erreur transports :", err);
        const errorHtml = `<div class="transport-error">${ICON_ALERT} Impossible de charger les horaires.</div>`;
        const tileEl = document.getElementById("transport-list");
        if (tileEl) tileEl.innerHTML = errorHtml;
        const favEl = document.getElementById("transport-favorites-list");
        if (favEl) favEl.innerHTML = errorHtml;
    }
}

initTransportLines();
loadNaolibStopOrder();
renderTransportRoutesList();
updateTransports();
transportInterval = setInterval(updateTransports, 60000);
initNearbyLines().then(() => {
    renderNearbyGrid("transport-nearby-grid", { interactive: false, showStars: false });
    renderNearbyGrid("transport-favoris-grid", { interactive: true, showStars: true });
});


// ─── Transports — Alertes trafic (infotrafic) ────────────────────────────────

const NAOLIB_INFOTRAFIC_URL = "https://plan.naolib.fr/api/infotrafic";

function stripHtmlToText(html) {
    if (!html) return "";
    return html
        // Remplace les saut de lignes HTML et fermetures de bloc par des retours à la ligne
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
        // Remplace les balises de fin d'élément par un espace pour éviter le texte collé
        .replace(/<[^>]+>/g, " ")
        // Nettoie les espaces et retours à la ligne multiples
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n/g, "\n")
        .trim();
}

// Fonction pour formater proprement les dates si fournies sous forme brute
function formatInfotraficDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // si la date est déjà une chaîne de texte
    
    const dateFormatted = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const timeFormatted = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `${dateFormatted} à ${timeFormatted}`;
}

// Fonction utilitaire pour nettoyer le texte HTML de la description
function cleanAlertContent(html) {
    if (!html) return "Aucun détail disponible.";
    return html;
}

// Fonction utilitaire pour formater les dates/périodes
function formatPeriod(alert) {
    // L'API Naolib fournit déjà startAt/endAt pré-formatés ("15/06/2026 à 05:00")
    if (alert.startAt && alert.endAt) {
        return `Du ${alert.startAt} au ${alert.endAt}`;
    }
    if (alert.startDate && alert.endDate) {
        return `Du ${alert.startDate} au ${alert.endDate}`;
    }
    if (alert.period) return alert.period;
    return "";
}

async function updateInfotrafic() {
    const container = document.getElementById("transport-alerts-modal");
    if (!container) return;

    try {
        const res = await fetch(NAOLIB_INFOTRAFIC_URL);
        if (!res.ok) throw new Error("HTTP " + res.status);
        
        const data = await res.json();
        const rawAlerts = Array.isArray(data) ? data : (data.disruptions || []);

        if (!Array.isArray(rawAlerts) || rawAlerts.length === 0) {
            container.innerHTML = `<div class="transport-loading">Aucune perturbation signalée sur le réseau.</div>`;
            return;
        }

        // 1. Structuration et regroupement par ligne
        const groupedByLine = {};

        rawAlerts.forEach(alert => {
            // Extrait le(s) numéro(s) de ligne concerné(s).
            // L'API Naolib expose ça dans `lineIds` : ["10"], ["C1"], etc.
            let lineNames = [];

            if (Array.isArray(alert.lineIds) && alert.lineIds.length > 0) {
                lineNames = alert.lineIds.map(id => String(id));
            } else if (alert.lines && Array.isArray(alert.lines) && alert.lines.length > 0) {
                lineNames = alert.lines.map(l => l.numLine || l.name || l.shortName || l.num || l);
            } else if (alert.concernedLines) {
                if (Array.isArray(alert.concernedLines)) {
                    lineNames = alert.concernedLines.map(l => l.numLine || l.name || l.num || l);
                } else if (typeof alert.concernedLines === 'object') {
                    lineNames = Object.keys(alert.concernedLines);
                }
            } else if (alert.line) {
                lineNames = [alert.line.numLine || alert.line.name || alert.line];
            }

            // Si aucune ligne n'est spécifiée, on classe dans "Réseau général / Autres"
            if (lineNames.length === 0) {
                lineNames = ["Infos Réseau"];
            }

            lineNames.forEach(lineName => {
                if (!groupedByLine[lineName]) {
                    groupedByLine[lineName] = [];
                }
                groupedByLine[lineName].push(alert);
            });
        });

        // 2. Tri des lignes (tri naturel : 1, 2, 3 ... 10, 11 ... puis lettres, "Infos Réseau" à la fin)
        function compareLineNames(a, b) {
            if (a === "Infos Réseau") return 1;
            if (b === "Infos Réseau") return -1;
            return a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });
        }
        const sortedLineNames = Object.keys(groupedByLine).sort(compareLineNames);

        // 3. Génère le HTML d'une carte de perturbation (une ou plusieurs lignes concernées)
        function renderAlertCard(lineNames, alert) {
            const chips = lineNames.map(lineName => {
                const badgeColor = lineName === "Infos Réseau" ? "#64748b" : lineColor(lineName);
                return `<span class="infotrafic-line-chip" style="background:${badgeColor}">${lineName}</span>`;
            }).join("");
            const titre = (alert.name || alert.title || alert.intitule || "Information").trim();
            const contenu = cleanAlertContent(alert.description || alert.text || alert.texte || alert.detail);
            const periode = formatPeriod(alert);

            return `
                <details class="infotrafic-card">
                    <summary class="infotrafic-summary">
                        <span class="infotrafic-row-main">
                            <span class="infotrafic-line-chips">${chips}</span>
                            <span class="infotrafic-row-title">${titre}</span>
                            ${periode ? `<span class="infotrafic-row-date">${periode}</span>` : ""}
                        </span>
                        <span class="infotrafic-row-arrow">➔</span>
                    </summary>
                    <div class="infotrafic-details">
                        ${contenu}
                    </div>
                </details>
            `;
        }

        // 4. Section "Perturbations sur mes lignes" — filtrée sur les lignes favorites.
        // Une même alerte peut toucher plusieurs lignes favorites : elle n'est
        // affichée qu'une fois, mais avec TOUS les badges de lignes favorites concernées.
        const favoriteLines = new Set(
            getTransportRoutes().map(r => String(r.lineNumber))
        );

        let favoritesHtml = "";
        if (favoriteLines.size > 0) {
            const favoriteAlertMap = new Map(); // alertKey -> { alert, lineNames: [] }

            sortedLineNames.forEach(lineName => {
                if (!favoriteLines.has(lineName)) return;
                groupedByLine[lineName].forEach(alert => {
                    const alertKey = alert.externalCode || alert.name;
                    if (!favoriteAlertMap.has(alertKey)) {
                        favoriteAlertMap.set(alertKey, { alert, lineNames: [] });
                    }
                    favoriteAlertMap.get(alertKey).lineNames.push(lineName);
                });
            });

            const favoriteRows = Array.from(favoriteAlertMap.values())
                .map(({ alert, lineNames }) => renderAlertCard(lineNames, alert));

            favoritesHtml = `
                <div class="infotrafic-topbar">
                    <span class="infotrafic-topbar-title">⭐ SUR MES LIGNES</span>
                    <span class="infotrafic-topbar-sep"></span>
                    <span class="infotrafic-badge">${favoriteRows.length}</span>
                </div>
                <div class="infotrafic-list">
                    ${favoriteRows.length > 0
                        ? favoriteRows.join("")
                        : `<div class="infotrafic-empty">Aucune perturbation sur tes lignes favorites 👍</div>`}
                </div>
            `;
        }

        // 5. Génération du HTML complet — une carte par perturbation UNIQUE, triée par ligne.
        // Une alerte qui touche plusieurs lignes n'apparaît qu'une fois, avec tous ses badges de ligne.
        const allAlertMap = new Map(); // alertKey -> { alert, lineNames: [] }
        sortedLineNames.forEach(lineName => {
            groupedByLine[lineName].forEach(alert => {
                const alertKey = alert.externalCode || alert.name;
                if (!allAlertMap.has(alertKey)) {
                    allAlertMap.set(alertKey, { alert, lineNames: [] });
                }
                allAlertMap.get(alertKey).lineNames.push(lineName);
            });
        });

        const totalPerturbations = allAlertMap.size;

        const rowsHtml = Array.from(allAlertMap.values())
            .sort((a, b) => compareLineNames(a.lineNames[0], b.lineNames[0]))
            .map(({ alert, lineNames }) => renderAlertCard(lineNames, alert))
            .join("");

        container.innerHTML = `
            ${favoritesHtml}
            <div class="infotrafic-topbar${favoritesHtml ? " infotrafic-topbar-secondary" : ""}">
                <span class="infotrafic-topbar-title">PERTURBATIONS DU SERVICE</span>
                <span class="infotrafic-topbar-sep"></span>
                <span class="infotrafic-badge">${totalPerturbations}</span>
            </div>
            <div class="infotrafic-list">
                ${rowsHtml}
            </div>
        `;

    } catch (err) {
        console.error("Erreur info trafic :", err);
        container.innerHTML = `<div class="transport-error">Impossible de charger les infos trafic.</div>`;
    }
}

updateInfotrafic();
infotraficInterval = setInterval(updateInfotrafic, 5 * 60 * 1000); // 5 min, les perturbations changent peu souvent


// ─── Appareils — Home Assistant ──────────────────────────────────────────────

// URL du proxy local qui protège le token HA (voir dossier ha-proxy/).
// Le token n'existe plus jamais ici, côté navigateur.
const HA_CONFIG = {
    url: "http://192.168.1.18:8787/ha"
};

// ⚠️ À CONFIGURER : tes pièces et tes appareils (entity_id trouvables dans
// HA → Outils de développement → États)
const ROOMS = [
    {
        name: "Salon",
        devices: [
            { entity_id: "light.salon_les_led_du_placard_outlet", label: "Led Placard" },
            { entity_id: "switch.poele_e",     label: "Poêle E" },
            { entity_id: "media_player.latele_2",           label: "TV" }
        ]
    },
    {
        name: "Salle de bain",
        devices: [
            { entity_id: "light.ampoule_sdb", label: "Ampoule" }
        ]
    }
];

// Map à plat : entity_id -> { label, room }
const HA_DEVICES = {};
ROOMS.forEach(room => {
    room.devices.forEach(d => {
        HA_DEVICES[d.entity_id] = { label: d.label, room: room.name };
    });
});

const haStates = {}; // entity_id -> "on" | "off" | "unavailable" ...
const haStatesFull = {}; // entity_id -> objet complet {state, attributes, ...} — partagé par batterie/Chromecast pour éviter des appels HA en double

function haShowStatus(message) {
    const el = document.getElementById("ha-status");
    if (!message) {
        el.style.display = "none";
        return;
    }
    el.textContent = message;
    el.style.display = "block";
}

function haIsOn(entityId) {
    return haStates[entityId] === "on";
}

async function haFetchStates() {
    try {
        const response = await fetch(`${HA_CONFIG.url}/api/states`, {
            headers: {
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();

        data.forEach(entity => {
            haStatesFull[entity.entity_id] = entity; // toutes les entités, pour batterie/Chromecast
            if (HA_DEVICES[entity.entity_id]) {
                haStates[entity.entity_id] = entity.state;
            }
        });

        haShowStatus(null);
        renderRooms();
        refreshFavoriteList();
        renderBatteryBadges();
        updateChromecast();

    } catch (err) {
        console.error("Home Assistant :", err);
        haShowStatus(`${ICON_ALERT} Impossible de joindre Home Assistant.`);
    }
}

async function haToggle(entityId) {
    // Optimiste : on inverse tout de suite dans l'UI
    haStates[entityId] = haIsOn(entityId) ? "off" : "on";
    renderRooms();
    refreshFavoriteList();

    try {
        const response = await fetch(`${HA_CONFIG.url}/api/services/homeassistant/toggle`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ entity_id: entityId })
        });
        if (!response.ok) throw new Error("HTTP " + response.status);

    } catch (err) {
        console.error("Home Assistant toggle :", err);
        haShowStatus(`${ICON_ALERT} Action impossible, nouvelle tentative...`);
    }

    // Re-synchronise avec l'état réel peu après
    setTimeout(haFetchStates, 1000);
}

function renderRooms() {
    const container = document.getElementById("rooms-container");
    container.innerHTML = "";

    ROOMS.forEach(room => {
        const card = document.createElement("div");
        card.className = "weather-card";
        card.style.marginTop = "20px";

        const title = document.createElement("h2");
        title.style.marginBottom = "20px";
        title.style.fontWeight = "bold";
        title.style.fontSize = "30px";
        title.textContent = room.name;
        card.appendChild(title);

        room.devices.forEach(d => {
            const isFav = getFavorites().includes(d.entity_id);
            const on = haIsOn(d.entity_id);

            const row = document.createElement("div");
            row.className = "device";
            row.innerHTML = `
                <div class="device-info">
                    <button class="favorite-btn ${isFav ? "active" : ""}"
                            onclick="toggleFavorite('${d.entity_id}')" aria-label="${isFav ? "Retirer" : "Ajouter"} ${d.label} des favoris">${isFav ? ICON_STAR_FILLED : ICON_STAR}</button>
                    <span>${d.label}</span>
                </div>
                <button class="toggle ${on ? "active" : ""}"
                        onclick="haToggle('${d.entity_id}')">${on ? "ON" : "OFF"}</button>
            `;
            card.appendChild(row);
        });

        container.appendChild(card);
    });
}

function allOff() {
    Object.keys(HA_DEVICES).forEach(entityId => {
        if (haStates[entityId] === "on") haToggle(entityId);
    });
}

haFetchStates();
haInterval = setInterval(haFetchStates, 5000);


// ─── Batterie téléphones (via Home Assistant / app Companion) ───────────────

const BATTERY_THRESHOLD = 15;

function getPhones() {
    return storageGet("phones_config", []);
}

function savePhones(phones) {
    storageSet("phones_config", phones);
}

// Interroge HA et ne garde que les capteurs de batterie (device_class: battery)
async function fetchAvailableBatterySensors() {
    try {
        const response = await fetch(`${HA_CONFIG.url}/api/states`, {
            headers: {
                "Content-Type": "application/json"
            }
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();

        return data
            .filter(e =>
                e.entity_id.startsWith("sensor.") &&
                e.attributes?.device_class === "battery"
            )
            .map(e => ({
                entity_id: e.entity_id,
                name: e.attributes.friendly_name || e.entity_id
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

    } catch (err) {
        console.error("Détection capteurs batterie :", err);
        return null;
    }
}

async function refreshPhoneEntitySelect() {
    const select = document.getElementById("new-phone-entity");
    if (!select) return;

    const sensors = await fetchAvailableBatterySensors();

    if (sensors === null) {
        select.innerHTML = `<option value="">⚠️ Home Assistant injoignable</option>`;
        return;
    }

    const already = new Set(getPhones().map(p => p.entity_id));
    const available = sensors.filter(s => !already.has(s.entity_id));

    if (available.length === 0) {
        select.innerHTML = `<option value="">Aucun nouveau capteur détecté</option>`;
        return;
    }

    select.innerHTML = `<option value="">Choisir un appareil détecté...</option>` +
        available.map(s => `<option value="${s.entity_id}">${s.name}</option>`).join("");
}

function addPhone() {
    const nameInput   = document.getElementById("new-phone-name");
    const entitySelect = document.getElementById("new-phone-entity");
    const label     = nameInput.value.trim();
    const entity_id = entitySelect.value;

    if (!label || !entity_id) return;

    const phones = getPhones();
    phones.push({ id: Date.now().toString(), label, entity_id });
    savePhones(phones);

    nameInput.value = "";

    renderPhonesList();
    renderBatteryBadges();
    refreshPhoneEntitySelect();
}

function removePhone(id) {
    savePhones(getPhones().filter(p => p.id !== id));
    renderPhonesList();
    renderBatteryBadges();
    refreshPhoneEntitySelect();
}

function renamePhone(id, newLabel) {
    const phones = getPhones();
    const phone = phones.find(p => p.id === id);
    if (phone) phone.label = newLabel.trim() || phone.label;
    savePhones(phones);
    renderBatteryBadges();
}

function renderPhonesList() {
    const container = document.getElementById("phones-list");
    if (!container) return;

    const phones = getPhones();

    if (phones.length === 0) {
        container.innerHTML = `<p style="color:#94a3b8;padding:10px 0;">Aucun téléphone suivi pour l'instant.</p>`;
        return;
    }

    container.innerHTML = "";
    phones.forEach(p => {
        const row = document.createElement("div");
        row.className = "phone-item";
        row.innerHTML = `
            <input type="text" class="phone-name-input" value="${p.label}"
                   onchange="renamePhone('${p.id}', this.value)">
            <span class="phone-entity">${p.entity_id}</span>
            <button class="phone-remove" onclick="removePhone('${p.id}')" aria-label="Supprimer ce téléphone">${ICON_X}</button>
        `;
        container.appendChild(row);
    });
}

function getBatteryLevel(entityId) {
    const entity = haStatesFull[entityId];
    if (!entity) return null;
    const level = parseInt(entity.state, 10);
    return isNaN(level) ? null : level;
}

// L'app Home Assistant Companion expose en général un capteur jumeau
// "..._battery_state" (valeurs : Charging / Not charging / Full / Discharging)
// à côté du capteur "..._battery_level". On le déduit du même entity_id.
function isBatteryCharging(entityId) {
    const stateEntityId = entityId.replace(/_battery_level$/, "_battery_state");
    if (stateEntityId === entityId) return false; // pas de capteur jumeau détectable
    const stateEntity = haStatesFull[stateEntityId];
    if (!stateEntity) return false;
    const state = String(stateEntity.state || "").toLowerCase();
    return state === "charging" || state === "full";
}

function renderBatteryBadges() {
    const container = document.getElementById("battery-badges");
    if (!container) return;

    const phones = getPhones();
    if (phones.length === 0) {
        container.innerHTML = "";
        return;
    }

    const results = phones.map(p => ({
        ...p,
        level: getBatteryLevel(p.entity_id),
        charging: isBatteryCharging(p.entity_id)
    }));

    container.innerHTML = "";
    results.forEach(p => {
        const badge = document.createElement("span");
        badge.className = "battery-badge";

        const icon = batteryIconFor(p.level, p.charging);

        if (p.level === null) {
            badge.innerHTML = `${icon} ${p.label} --%`;
        } else {
            badge.innerHTML = `${icon} ${p.label} ${p.level}%`;
            if (!p.charging && p.level <= BATTERY_THRESHOLD) badge.classList.add("low-battery");
        }

        container.appendChild(badge);
    });
}

renderPhonesList();
renderBatteryBadges();
refreshPhoneEntitySelect();
phoneSelectInterval = setInterval(refreshPhoneEntitySelect, 30000); // détecte les nouveaux capteurs périodiquement


// ─── Navigation ─────────────────────────────────────────────────────────────

function showPage(pageId, button) {
    document.querySelectorAll(".page").forEach(page => {
        page.style.display = "none";
    });
    document.getElementById(pageId).style.display = "";
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.remove("active-nav");
    });
    button.classList.add("active-nav");
}


// ─── Mode Miroir ────────────────────────────────────────────────────────────

let mirrorStream = null;

async function startMirror() {
    const overlay = document.getElementById("mirrorOverlay");
    const video   = document.getElementById("mirrorVideo");
    const errorEl = document.getElementById("mirrorError");

    errorEl.textContent = "";

    try {
        mirrorStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: false
        });
        video.srcObject = mirrorStream;
        overlay.classList.add("active");
    } catch (err) {
        console.error("Caméra :", err);
        errorEl.textContent = "⚠️ Impossible d'accéder à la caméra avant.";
        overlay.classList.add("active");
    }
}

function stopMirror() {
    if (mirrorStream) {
        mirrorStream.getTracks().forEach(track => track.stop());
        mirrorStream = null;
    }
    document.getElementById("mirrorOverlay").classList.remove("active");
}


// ─── Widgets de l'Accueil ────────────────────────────────────────────────────

const WIDGETS = [
    { widgetId: 'widget-meteo',     checkId: 'chk-meteo'     },
    { widgetId: 'widget-transport', checkId: 'chk-transport'  },
    { widgetId: 'widget-miroir',    checkId: 'chk-miroir'     },
    { widgetId: 'spotifyCard',      checkId: 'chk-spotify'    },
    { widgetId: 'chromecastCard',   checkId: 'chk-chromecast' },
];

function initWidgetToggles() {
    const saved = storageGet('widgets_visibility', {});
    WIDGETS.forEach(({ widgetId, checkId }) => {
        const visible = saved[widgetId] !== false; // true par défaut
        const el  = document.getElementById(widgetId);
        const chk = document.getElementById(checkId);
        if (el)  el.style.display  = visible ? '' : 'none';
        if (chk) chk.checked       = visible;
    });
}

function toggleWidget(widgetId, visible) {
    const el = document.getElementById(widgetId);
    if (el) el.style.display = visible ? '' : 'none';

    const saved = storageGet('widgets_visibility', {});
    saved[widgetId] = visible;
    storageSet('widgets_visibility', saved);
}

initWidgetToggles();


// ─── Spotify ────────────────────────────────────────────────────────────────

const SPOTIFY_CLIENT_ID    = "e5f7b5f7ee1747f6a10f9c2a87af35a5"; // ← 
const SPOTIFY_REDIRECT_URI = "https://steve1676.github.io/dashboard-domotique/DashBoard/";
const SPOTIFY_SCOPES       = "user-read-playback-state user-read-currently-playing user-modify-playback-state user-top-read";

let spotifyLastTrackId = null;
let spotifyCurrentData = null; // dernière réponse /me/player connue, pour le popup lecteur
let spotifyCurrentDataFetchedAt = 0; // Date.now() local au moment de la réponse (jamais l'horloge serveur — cf. spotifyRenderPlayerModal)
let spotifyRecsLoaded = false;
let spotifyRecsData = [];
let spotifyRecIndex = 0;
let spotifyRecTimer = null;

// -- PKCE helpers --

function spotifyRandomString(length) {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function spotifySha256(plain) {
    const data = new TextEncoder().encode(plain);
    return window.crypto.subtle.digest("SHA-256", data);
}

function spotifyBase64Url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

// -- Connexion --

async function spotifyLogin() {
    const verifier  = spotifyRandomString(64);
    const challenge = spotifyBase64Url(await spotifySha256(verifier));

    localStorage.setItem("spotify_code_verifier", verifier);

    const params = new URLSearchParams({
        response_type: "code",
        client_id: SPOTIFY_CLIENT_ID,
        scope: SPOTIFY_SCOPES,
        code_challenge_method: "S256",
        code_challenge: challenge,
        redirect_uri: SPOTIFY_REDIRECT_URI
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function spotifyHandleRedirect() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    const verifier = localStorage.getItem("spotify_code_verifier");

    try {
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: SPOTIFY_REDIRECT_URI,
                client_id: SPOTIFY_CLIENT_ID,
                code_verifier: verifier
            })
        });

        const data = await response.json();
        if (data.access_token) spotifySaveTokens(data);

    } catch (err) {
        console.error("Spotify auth :", err);
    }

    // Nettoie l'URL (retire ?code=...)
    window.history.replaceState({}, document.title, SPOTIFY_REDIRECT_URI);
}

function spotifySaveTokens(data) {
    localStorage.setItem("spotify_access_token", data.access_token);
    localStorage.setItem("spotify_token_expires", Date.now() + data.expires_in * 1000);
    if (data.refresh_token) {
        localStorage.setItem("spotify_refresh_token", data.refresh_token);
    }
}

function spotifyGetDisplayStyle() {
    return storageGet("spotify_display_style", "normal");
}

function spotifySetDisplayStyle(style) {
    storageSet("spotify_display_style", style);
    spotifyRenderStyleButtons();
    spotifyRenderPlayerModal(); // applique tout de suite si le popup est ouvert
}

function spotifyRenderStyleButtons() {
    const current = spotifyGetDisplayStyle();
    document.getElementById("spotifyStyleBtn-normal").classList.toggle("selected", current === "normal");
    document.getElementById("spotifyStyleBtn-vinyl").classList.toggle("selected", current === "vinyl");
}

function spotifyOpenSettings() {
    const connected = !!localStorage.getItem("spotify_access_token");
    document.getElementById("spotifySettingsStatus").textContent = connected
        ? "Connecté. Se déconnecter force une reconnexion (utile après l'ajout d'une nouvelle permission, par ex.)."
        : "Non connecté.";
    spotifyRenderStyleButtons();
    openWidgetModal("spotify-settings");
}

function spotifyLogout() {
    localStorage.removeItem("spotify_access_token");
    localStorage.removeItem("spotify_refresh_token");
    localStorage.removeItem("spotify_token_expires");
    spotifyLastTrackId = null;
    spotifyCurrentData = null;
    spotifyRecsLoaded = false;
    spotifyRecsData = [];
    spotifyShowLogin();
    closeWidgetModal();
}

async function spotifyRefreshToken() {
    const refreshToken = localStorage.getItem("spotify_refresh_token");
    if (!refreshToken) return null;

    try {
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: SPOTIFY_CLIENT_ID
            })
        });

        const data = await response.json();
        if (data.access_token) {
            spotifySaveTokens(data);
            return data.access_token;
        }
    } catch (err) {
        console.error("Spotify refresh :", err);
    }
    return null;
}

async function spotifyGetToken() {
    const token   = localStorage.getItem("spotify_access_token");
    const expires = parseInt(localStorage.getItem("spotify_token_expires") || "0");

    if (!token) return null;
    if (Date.now() > expires - 10000) return await spotifyRefreshToken();
    return token;
}

function spotifyShowLogin() {
    document.getElementById("spotifyLoggedOut").style.display = "flex";
    document.getElementById("spotifyIdle").style.display = "none";
    document.getElementById("spotifyPlayer").style.display = "none";
    clearInterval(spotifyRecTimer);
    spotifyRecTimer = null;
}

function spotifyShowPlayer() {
    document.getElementById("spotifyLoggedOut").style.display = "none";
    document.getElementById("spotifyIdle").style.display = "none";
    document.getElementById("spotifyPlayer").style.display = "flex";
    document.getElementById("spotifyBgBlur").style.filter = ""; // flou par défaut pendant la lecture
    clearInterval(spotifyRecTimer);
    spotifyRecTimer = null;
}

function spotifyShowIdle() {
    document.getElementById("spotifyLoggedOut").style.display = "none";
    document.getElementById("spotifyPlayer").style.display = "none";
    document.getElementById("spotifyIdle").style.display = "flex";
    spotifyCurrentData = null;
    if (!spotifyRecsLoaded) {
        spotifyRecsLoaded = true;
        console.log("[Spotify recos] chargement déclenché (spotifyShowIdle)");
        spotifyLoadRecommendations();
    }
}

// Pose une image "en entier" (pas de recadrage) avec un calque flouté/agrandi
// en dessous pour combler les bords — même principe que le widget Chromecast
function spotifySetImage(url) {
    const bg = document.getElementById("spotifyAlbumArt");
    const blur = document.getElementById("spotifyBgBlur");
    bg.style.backgroundImage = `url(${url})`;
    bg.style.backgroundSize = "contain";
    bg.style.backgroundRepeat = "no-repeat";
    bg.style.backgroundColor = "transparent";
    blur.style.backgroundImage = `url(${url})`;
}

function spotifyClearImage() {
    const bg = document.getElementById("spotifyAlbumArt");
    const blur = document.getElementById("spotifyBgBlur");
    bg.style.backgroundImage = "none";
    bg.style.backgroundSize = "";
    bg.style.backgroundRepeat = "";
    bg.style.backgroundColor = "";
    blur.style.backgroundImage = "none";
}

// -- Lecture en cours --

// Icônes play/pause (Tabler) — un seul point de vérité pour éviter la
// duplication de markup SVG, et un data-attribute pour connaître l'état
// actuel sans avoir à parser le contenu du bouton.
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" class="icon-btn"><path d="M6 4v16l14 -8z" /></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" class="icon-btn"><path d="M6 4h4v16h-4z" /><path d="M14 4h4v16h-4z" /></svg>';

function setPlayPauseIcon(btn, isPlaying) {
    btn.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
    btn.dataset.playing = isPlaying ? "true" : "false";
}

async function spotifyUpdatePlayer() {
    const token = await spotifyGetToken();
    if (!token) { spotifyShowLogin(); return; }

    try {
        const response = await fetch("https://api.spotify.com/v1/me/player", {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.status === 401) {
            localStorage.removeItem("spotify_access_token");
            spotifyShowLogin();
            return;
        }

        if (response.status === 204 || response.status === 404) {
            spotifyShowIdle();
            return;
        }

        const data = await response.json();
        if (!data || !data.item) {
            spotifyShowIdle();
            return;
        }

        spotifyShowPlayer();
        spotifyRecsLoaded = false; // en lecture : les recos seront recalculées à la prochaine veille
        spotifyCurrentData = data;
        spotifyCurrentDataFetchedAt = Date.now();

        document.getElementById("spotifyTitle").textContent  = data.item.name;
        document.getElementById("spotifyArtist").textContent = data.item.artists.map(a => a.name).join(", ");
        setPlayPauseIcon(document.getElementById("spotifyPlayPause"), data.is_playing);

        if (data.item.id !== spotifyLastTrackId) {
            spotifyLastTrackId = data.item.id;
            const art = data.item.album?.images?.[0]?.url;
            if (art) spotifySetImage(art); else spotifyClearImage();
        }

        spotifyRenderPlayerModal(); // tient le popup à jour s'il est ouvert

    } catch (err) {
        console.error("Spotify player :", err);
    }
}

// -- Recommandations (rien en lecture) --
//
// L'endpoint officiel /v1/recommendations de Spotify est désactivé pour toute
// appli créée après le 27/11/2024 (403 systématique). À la place : artistes
// les plus écoutés récemment (/me/top/artists, nécessite le scope
// user-top-read) → genres dominants → recherche de titres correspondants.

async function spotifyLoadRecommendations() {
    const token = await spotifyGetToken();
    if (!token) { console.log("[Spotify recos] pas de token, abandon"); return; }

    try {
        // short_term (4 dernières semaines) met souvent plusieurs jours à se
        // peupler après une écoute récente. On tente d'abord ça, puis on
        // retombe sur medium_term (~6 derniers mois) et long_term (plusieurs
        // années) si vide — bien plus susceptibles d'avoir déjà des données
        // dès maintenant, vu que ton historique Spotify existait déjà avant.
        let artists = [];
        for (const range of ["short_term", "medium_term", "long_term"]) {
            const topRes = await fetch(`https://api.spotify.com/v1/me/top/artists?limit=6&time_range=${range}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log(`[Spotify recos] /me/top/artists (${range}) → statut ${topRes.status}`);
            // 403 probable si le token a été obtenu avant l'ajout du scope user-top-read
            if (!topRes.ok) {
                const body = await topRes.text();
                console.log("[Spotify recos] réponse en erreur :", body);
                spotifyRecsData = []; spotifyRenderRecs(); return;
            }

            const topData = await topRes.json();
            artists = topData.artists || [];
            console.log(`[Spotify recos] ${artists.length} artiste(s) trouvé(s) pour ${range}`);
            if (artists.length > 0) break;
        }
        if (artists.length === 0) { console.log("[Spotify recos] aucun artiste sur aucune période, abandon"); spotifyRecsData = []; spotifyRenderRecs(); return; }

        // Genres dominants parmi ces artistes (pondérés par rang de popularité perso)
        const genreScores = new Map();
        artists.forEach((a, i) => (a.genres || []).forEach(g =>
            genreScores.set(g, (genreScores.get(g) || 0) + (artists.length - i))
        ));
        const topGenres = [...genreScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g);
        console.log("[Spotify recos] genres dominants :", topGenres);

        const queries = [
            ...artists.slice(0, 2).map(a => `artist:"${a.name}"`),
            ...topGenres.map(g => `genre:"${g}"`)
        ];
        console.log("[Spotify recos] requêtes de recherche :", queries);

        const results = await Promise.all(queries.map(q =>
            fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=5`, {
                headers: { Authorization: `Bearer ${token}` }
            }).then(r => r.ok ? r.json() : null).catch(() => null)
        ));

        const seen = new Set();
        const tracks = [];
        results.forEach(r => (r?.tracks?.items || []).forEach(t => {
            if (seen.has(t.id)) return;
            seen.add(t.id);
            tracks.push({
                uri: t.uri,
                title: t.name,
                artist: t.artists.map(a => a.name).join(", "),
                image: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || null,
            });
        }));

        console.log(`[Spotify recos] ${tracks.length} titre(s) trouvé(s) au total`);

        // Mélange (sinon les résultats sont groupés requête par requête)
        for (let i = tracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }

        spotifyRecsData = tracks.slice(0, 3);
        console.log("[Spotify recos] rendu de", spotifyRecsData.length, "reco(s)");
        spotifyRenderRecs();
    } catch (err) {
        console.error("[Spotify recos] erreur :", err);
    }
}

function spotifyRenderRecs() {
    // Même garde que côté Chromecast : réponse async arrivée après qu'une
    // vraie lecture a démarré → on n'écrase pas la pochette en cours.
    if (document.getElementById("spotifyIdle").style.display === "none") return;

    const tap = document.getElementById("spotifyRecTap");
    const nav = document.getElementById("spotifyRecNav");
    const empty = document.getElementById("spotifyRecEmpty");
    const badge = document.getElementById("spotifyRecBadge");
    if (!tap || !nav || !empty) return;

    clearInterval(spotifyRecTimer);
    spotifyRecTimer = null;

    if (spotifyRecsData.length === 0) {
        tap.style.display = "none";
        nav.style.display = "none";
        badge.style.display = "none";
        empty.style.display = "flex";
        spotifyClearImage();
        return;
    }

    empty.style.display = "none";
    tap.style.display = "flex";
    badge.style.display = "flex";
    nav.style.display = spotifyRecsData.length > 1 ? "flex" : "none";
    spotifyRecIndex = 0;
    spotifyRenderCurrentRec();

    if (spotifyRecsData.length > 1) {
        spotifyRecTimer = setInterval(spotifyRecNext, 8000);
    }
}

function spotifyRenderCurrentRec() {
    const rec = spotifyRecsData[spotifyRecIndex];
    if (!rec) return;

    if (rec.image) spotifySetImage(rec.image); else spotifyClearImage();

    document.getElementById("spotifyRecTitle").textContent = rec.title;
    document.getElementById("spotifyRecMeta").textContent = rec.artist;

    const dots = document.getElementById("spotifyRecDots");
    dots.innerHTML = spotifyRecsData.map((_, i) =>
        `<span class="chromecast-rec-dot${i === spotifyRecIndex ? ' active' : ''}"></span>`
    ).join("");
}

function spotifyRecNext() {
    if (spotifyRecsData.length === 0) return;
    spotifyRecIndex = (spotifyRecIndex + 1) % spotifyRecsData.length;
    spotifyRenderCurrentRec();
}

function spotifyRecPrev() {
    if (spotifyRecsData.length === 0) return;
    spotifyRecIndex = (spotifyRecIndex - 1 + spotifyRecsData.length) % spotifyRecsData.length;
    spotifyRenderCurrentRec();
}

// Lance directement la lecture de la suggestion (nécessite un appareil Spotify actif)
async function spotifyPlayRec(index) {
    const rec = spotifyRecsData[index];
    if (!rec) return;
    const token = await spotifyGetToken();
    if (!token) return;
    try {
        await fetch("https://api.spotify.com/v1/me/player/play", {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ uris: [rec.uri] })
        });
        setTimeout(spotifyUpdatePlayer, 500);
    } catch (err) {
        console.error("Spotify lecture suggestion :", err);
    }
}

// -- Popup "lecteur en grand" --

function spotifyFormatTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function spotifyRenderPlayerModal() {
    const modal = document.getElementById("modal-spotify-player");
    if (!modal || !modal.classList.contains("visible") || !spotifyCurrentData?.item) return;

    const data = spotifyCurrentData;
    const item = data.item;

    const bgImage = document.getElementById("spotifyAlbumArt").style.backgroundImage;
    const resolvedImage = bgImage && bgImage !== "none" ? bgImage : "none";
    document.getElementById("spotifyPlayerModalPoster").style.backgroundImage = resolvedImage;
    document.getElementById("spotifyPlayerModalPosterBlur").style.backgroundImage = resolvedImage;

    // Mode vinyle : la pochette tourne comme un disque, en rotation seulement
    // pendant la lecture (mise en pause visuelle si le morceau est en pause)
    const posterWrap = document.getElementById("spotifyPlayerModalPosterWrap");
    posterWrap.classList.toggle("vinyl-mode", spotifyGetDisplayStyle() === "vinyl");
    posterWrap.classList.toggle("vinyl-paused", !data.is_playing);

    document.getElementById("spotifyPlayerModalTitle").textContent = item.name;
    document.getElementById("spotifyPlayerModalMeta").textContent =
        `${item.artists.map(a => a.name).join(", ")} · ${item.album?.name || ""}`;

    setPlayPauseIcon(document.getElementById("spotifyPlayerModalPlayPause"), data.is_playing);

    const progress = document.getElementById("spotifyPlayerModalProgress");
    if (Number.isFinite(item.duration_ms) && item.duration_ms > 0) {
        let position = data.progress_ms || 0;
        if (data.is_playing && spotifyCurrentDataFetchedAt) {
            // Horloge locale uniquement des deux côtés (jamais data.timestamp,
            // qui vient du serveur Spotify et peut être désynchro de l'appareil)
            position += Math.max(0, Date.now() - spotifyCurrentDataFetchedAt);
        }
        position = Math.min(position, item.duration_ms);

        progress.style.display = "block";
        document.getElementById("spotifyPlayerModalProgressFill").style.width = `${(position / item.duration_ms) * 100}%`;
        document.getElementById("spotifyPlayerModalPosition").textContent = spotifyFormatTime(position);
        document.getElementById("spotifyPlayerModalDuration").textContent = spotifyFormatTime(item.duration_ms);
    } else {
        progress.style.display = "none";
    }
}

let spotifyProgressTicker = null;

function spotifyOpenPlayerModal() {
    if (!spotifyCurrentData?.item) return;
    openWidgetModal("spotify-player");
    spotifyRenderPlayerModal();

    // Rafraîchit la barre de progression toutes les 500ms à partir des
    // données déjà en cache (pas de nouvel appel réseau) — sinon elle ne
    // bouge qu'au rythme du poll API (5s) et donne l'impression de sauter.
    // S'arrête tout seul dès que le popup n'est plus visible.
    clearInterval(spotifyProgressTicker);
    spotifyProgressTicker = setInterval(() => {
        const modal = document.getElementById("modal-spotify-player");
        if (!modal || !modal.classList.contains("visible")) {
            clearInterval(spotifyProgressTicker);
            spotifyProgressTicker = null;
            return;
        }
        spotifyRenderPlayerModal();
    }, 500);
}

// -- Contrôles --

async function spotifyTogglePlay() {
    const token = await spotifyGetToken();
    if (!token) return;

    const btn = document.getElementById("spotifyPlayPause");
    const endpoint = btn.dataset.playing === "true" ? "pause" : "play";

    await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` }
    });

    setTimeout(spotifyUpdatePlayer, 500);
}

async function spotifyNext() {
    const token = await spotifyGetToken();
    if (!token) return;

    await fetch("https://api.spotify.com/v1/me/player/next", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
    });

    setTimeout(spotifyUpdatePlayer, 500);
}

async function spotifyPrev() {
    const token = await spotifyGetToken();
    if (!token) return;

    await fetch("https://api.spotify.com/v1/me/player/previous", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
    });

    setTimeout(spotifyUpdatePlayer, 500);
}

// -- Démarrage --

spotifyHandleRedirect().then(() => {
    spotifyUpdatePlayer();
    spotifyInterval = setInterval(spotifyUpdatePlayer, 5000);
});

// ─── Chromecast (via Home Assistant) ─────────────────────────────────────────

const CHROMECAST_ENTITY_ID = "media_player.latele";

// Clé API YouTube Data v3 — à créer sur https://console.cloud.google.com
// (active "YouTube Data API v3" puis crée une clé API dans "Identifiants")
const YOUTUBE_API_KEY = "AIzaSyCDc5MPkXyNH6P7xo_aZRgMuv1ouO5T8ZA";

let chromecastLastImage = null;
let chromecastImageObjectUrl = null;
let chromecastLastSearchedTitle = null;
let chromecastWasPlaying = false; // détecte la transition lecture → veille, pour ne nettoyer qu'une fois
let chromecastCurrentAttrs = null; // derniers attrs HA connus, pour peupler le popup lecteur en grand
let chromecastCurrentAttrsFetchedAt = 0; // Date.now() local à la réception (jamais l'horloge HA — cf. chromecastRenderPlayerModal)
let chromecastCurrentState = null;

const YOUTUBE_THUMB_CACHE_KEY = "chromecast_yt_thumb_cache";

function chromecastGetThumbCache() {
    return storageGet(YOUTUBE_THUMB_CACHE_KEY, {});
}

function chromecastSaveThumbCache(cache) {
    try {
        storageSet(YOUTUBE_THUMB_CACHE_KEY, cache);
    } catch (err) {
        console.error("Chromecast cache vignette :", err);
    }
}

// Recherche une vignette YouTube à partir du titre de la vidéo (utilisé quand
// HA ne fournit pas entity_picture). Résultat mis en cache par titre pour
// économiser le quota gratuit de l'API (100 unités par recherche).
async function chromecastSearchYoutubeThumbnail(title) {
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY.startsWith("COLLE_")) return null;

    const cache = chromecastGetThumbCache();
    if (cache[title]) return cache[title];

    try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&type=video&q=${encodeURIComponent(title)}&key=${YOUTUBE_API_KEY}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();

        const thumbnails = data.items?.[0]?.snippet?.thumbnails;
        const thumb = thumbnails?.high?.url || thumbnails?.medium?.url || thumbnails?.default?.url || null;

        if (thumb) {
            cache[title] = thumb;
            chromecastSaveThumbCache(cache);
        }
        return thumb;
    } catch (err) {
        console.error("Chromecast recherche YouTube :", err);
        return null;
    }
}

// Fallback visuel (couleur + logo) quand aucune image n'est disponible / trouvée
// (juste après le lancement d'une appli, le temps que la vignette charge)
const CHROMECAST_APP_STYLES = {
    "youtube":        { color: "#FF0000", logo: `<svg viewBox="0 0 24 24" width="40" height="40" fill="#fff"><path d="M18 3a5 5 0 0 1 5 5v8a5 5 0 0 1 -5 5h-12a5 5 0 0 1 -5 -5v-8a5 5 0 0 1 5 -5zm-9 6v6a1 1 0 0 0 1.514 .857l5 -3a1 1 0 0 0 0 -1.714l-5 -3a1 1 0 0 0 -1.514 .857z" /></svg>` },
    "netflix":        { color: "#E50914", logo: `<svg viewBox="0 0 24 24" width="40" height="40" fill="#fff" stroke="#fff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3l10 18h-4l-10 -18z" /><path d="M5 3v18h4v-10.5" /><path d="M19 21v-18h-4v10.5" /></svg>` },
    "disney+":        { color: "#113CCF", logo: `<svg viewBox="0 0 24 24" width="40" height="40" fill="#fff" stroke="#fff"  stroke-width="1" stroke-linecap="round"  stroke-linejoin="round"><path d="M3.225.838c-1.307 -.15 -1.22 -.578 -1.22 -.794c0 -.216 .424 -1.044 4.34 -1.044c4.694 0 14.66 3.645 14.66 10.042s-8.71 4.931 -10.435 4.52c-1.724 -.412 -5.565 -2.256 -5.565 -4.174c0 -1.395 3.08 -2.388 6.715 -2.388c3.634 0 5.285 1.041 5.285 2c0 .5 -.074 1.229 -1 1.5" /><path d="M10.02 8a505.153 505.153 0 0 0 0 13" /></svg>` },
    "prime video":    { color: "#00A8E1", logo: `<svg viewBox="0 0 24 24" width="40" height="40"><polygon points="9,7 17,12 9,17" fill="#fff"/><path d="M6 19 Q12 22 18 19" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>` },
    "crunchyroll":    { color: "#F47521", logo: `<svg viewBox="0 0 900 507" width="42" height="24" fill="#ffffff" fill-rule="evenodd"><path d="M426.01 0.1C436.06 0.1 446.11 0.1 456.16 0.1C456.94 1.64 464.15 1.77 466.34 1.92C472.37 2.34 478.6 3.87 484.44 5.29C487.96 6.14 491.37 7.8 495 7.99C500.34 9.97 505.68 11.96 511.03 13.94C517.12 16.5 523.24 19.14 529.05 22.33C532.61 24.28 536.1 26.88 539.87 28.35C540.91 29.05 541.95 29.74 542.99 30.44C546.72 32.99 550.46 35.55 554.2 38.11C557.57 40.8 560.94 43.5 564.31 46.19C566.05 47.83 567.79 49.48 569.52 51.12C572.64 54.24 575.76 57.36 578.88 60.47C580.54 62.21 582.19 63.95 583.84 65.69C586.56 69.06 589.27 72.42 591.99 75.78C594.43 79.22 596.86 82.65 599.3 86.08C600.25 87.45 601.2 88.82 602.16 90.19C607.1 99.98 612.04 109.77 616.99 119.56C618.89 124.91 620.8 130.26 622.71 135.61C624.09 146.15 628.45 156.03 629.06 167.05C629.54 171.37 630.01 175.68 630.49 180C630.56 184.93 630.64 189.86 630.72 194.79C630.56 196.42 630.4 198.05 630.25 199.68C629.97 198.05 629.69 196.42 629.41 194.79C628.59 189.85 627.78 184.9 626.96 179.95C626.77 172.97 619.1 150.42 615.35 144.25C613.67 140.91 611.99 137.57 610.3 134.23C601.16 113.12 579.27 92.68 561.5 78.66C555.55 73.97 547.98 68.19 540.75 65.85C536.42 63.75 532.09 61.65 527.76 59.56C521.32 56.12 502.35 49.6 495.33 49.85C489.87 48.91 484.42 47.98 478.97 47.05C474.45 46.82 469.93 46.59 465.41 46.36C460.27 46.52 455.14 46.69 450 46.86C445.04 47.45 440.08 48.03 435.12 48.62C430.01 49.69 424.9 50.76 419.79 51.83C408.93 53.38 397.53 58.9 387.81 63.82C381.93 66.78 375.1 69.64 370.13 74.05C366.5 76.65 362.87 79.26 359.24 81.87C356 84.53 352.77 87.19 349.53 89.85C347.88 91.36 346.22 92.87 344.57 94.38C341.33 97.85 338.09 101.32 334.84 104.79C333 107.13 331.15 109.46 329.3 111.8C320 121.8 313.14 135.49 307.91 148C305.81 153.02 302.28 158.87 301.97 164.36C301.11 167.1 300.24 169.83 299.38 172.56C296.49 181.66 294.8 192.6 294.73 202.16C293.21 205.12 293.38 223.25 294.68 226.39C294.91 235.45 296.3 247.88 299.42 256.39C300.9 260.98 302.38 265.56 303.86 270.15C304.92 277.42 309.53 285.55 313.1 291.93C314.57 294.56 315.68 298.23 317.89 300.25C319.42 304.02 322.04 307.48 324.53 310.7C334.06 323.07 343.61 334.24 355.65 344.32C361.11 348.89 368 355.23 374.74 357.62C379.11 362.31 398.28 369.79 404.84 372.38C414.39 376.07 424.94 379.08 435.21 380.25C440.02 381 444.83 381.75 449.64 382.5C444.83 382.63 440.02 382.75 435.21 382.88C430.07 382.52 424.93 382.16 419.79 381.8C414.86 381.13 409.93 380.45 405 379.78C400.08 378.72 395.16 377.65 390.24 376.59C385.73 374.18 379.54 373.25 374.59 371.58C369.68 369.92 364.95 367 360 365.72C353.95 362.08 347.27 359.27 341.1 355.81C337.36 353.71 333.79 350.47 329.93 348.81C327.74 346.33 324.24 344.68 321.6 342.62C316.04 338.27 310.49 333.54 305.46 328.56C299.04 322.2 292.98 315.45 287.35 308.41C285.15 305.67 283.6 302.23 281.01 299.86C275.32 289.82 269.63 279.79 263.93 269.75C263.14 264.78 260.08 259.14 258.08 254.47C256.01 249.65 255.38 244.13 253.53 239.22C252.45 234.43 251.38 229.65 250.3 224.86C249.83 218.41 248.37 212.04 247.95 205.58C247.39 197.05 248.26 188.46 247.81 179.97C248.24 174.84 248.67 169.72 249.11 164.59C250.05 159.66 251 154.73 251.95 149.79C253.2 145.2 254.45 140.6 255.7 136.01C258.14 124.98 264.56 115.39 268.06 104.79C268.88 103.27 269.69 101.74 270.51 100.22C272.41 96.87 274.31 93.53 276.21 90.19C279.31 85.8 282.41 81.41 285.51 77.02C294.08 65.82 303.52 55.06 314.44 45.97C321.12 40.41 328.8 35.92 335.3 30.31C338.66 28.24 342.02 26.17 345.39 24.1C348.21 23.53 350.72 21.41 353.29 20.11C357 18.24 360.95 16.65 364.72 14.94C377.52 9.15 391.31 5.9 405 2.92C412 1.98 419.01 1.04 426.01 0.1ZM472.71 89.46C474.38 89.58 476.06 89.7 477.74 89.82C478.56 89.83 479.38 89.84 480.21 89.85C483.49 90.21 486.78 90.57 490.07 90.93C498.97 91.41 508.33 94.09 516.67 97.07C519.21 97.98 521.77 99.32 524.4 99.93C527.44 101.39 530.48 102.84 533.53 104.3C533.63 104.75 533.73 105.21 533.83 105.67C516.39 109.66 498.54 132.75 495.78 149.79C494.41 154.58 493.87 160.27 494.44 165.21C494.71 170.07 495.13 175.44 497 180C497.79 184.84 500.59 191.02 503.7 194.79C505.7 197.47 507.69 200.15 509.68 202.83C511.41 205.81 515.01 209.19 518.05 210.75C520.15 212.24 522.26 213.73 524.37 215.21C528.59 218.01 534.87 221.33 540 221.77C544.79 222.89 549.74 224.09 554.7 223.72C559.44 224.14 565.82 223.86 570.21 221.85C580 221.23 594.23 211.63 600.37 204.14C601.72 202.73 603.07 201.33 604.42 199.92C604.98 203.14 605.54 206.37 606.11 209.59C606.44 214.75 606.77 219.92 607.11 225.08C606.77 229.99 606.43 234.89 606.09 239.79C605.21 244.69 604.34 249.58 603.46 254.47C602.16 259.01 600.87 263.55 599.57 268.09C599.42 268.67 599.26 269.25 599.1 269.83C597.02 274.64 594.95 279.45 592.87 284.26C590.23 288.94 587.59 293.63 584.96 298.31C584.33 299.12 583.7 299.93 583.07 300.74C579.41 305.29 575.76 309.84 572.1 314.38C571.09 315.5 570.08 316.62 569.07 317.73C565.18 321.34 561.3 324.95 557.41 328.55C556.52 329.19 555.63 329.83 554.74 330.46C550.33 333.56 545.91 336.65 541.5 339.75C538.55 341.4 535.59 343.05 532.64 344.71C530.02 345.88 527.4 347.06 524.78 348.24C519.7 350.07 514.62 351.91 509.55 353.75C504.73 354.79 499.91 355.83 495.08 356.87C490.12 357.49 485.16 358.1 480.21 358.71C471.48 357.9 462.72 358.93 454.01 357.55C447.92 356.58 441.55 354.06 435.45 353.75C430.36 351.99 425.26 350.22 420.17 348.46C416.12 345.11 409.54 343.31 404.85 340.7C400.03 338.01 395.82 333.96 390.89 331.58C390.05 330.93 389.21 330.28 388.37 329.63C384.06 325.61 379.74 321.59 375.43 317.56C374.36 316.49 373.3 315.42 372.23 314.35C364.03 305.61 357.49 295.13 351.84 284.61C349.41 280.08 348.13 274.19 345.3 270.15C343.84 264.94 342.38 259.73 340.92 254.51C340.51 248.49 338.54 242.46 338.02 236.37C337.24 227.41 338.1 218.53 338.23 209.59C338.99 204.89 339.74 200.19 340.5 195.49C342.01 190.33 343.51 185.16 345.02 180C345.25 179.32 345.49 178.63 345.72 177.95C347.59 173.52 349.46 169.09 351.33 164.66C354.06 159.9 356.79 155.15 359.52 150.39C367.84 139.62 375.71 129.11 386.35 120.35C390.89 116.61 395.77 113.27 400.69 110.05C403.09 108.49 405.96 107.43 408.16 105.63C412.24 103.7 416.33 101.77 420.41 99.84C425.74 98.6 430.83 95.81 436.17 94.37C442.38 92.69 448.69 91.98 454.95 90.71C458.23 90.41 461.51 90.12 464.79 89.83C467.43 89.7 470.07 89.58 472.71 89.46ZM453.85 422.18C454 428.06 454.16 433.95 454.32 439.83C463.69 438.74 472.14 438.02 479.55 444.98C480.6 446.66 481.66 448.33 482.72 450C483.92 455.03 483.9 459.62 484.1 464.79C484.1 469.73 484.11 474.66 484.11 479.59C484 482.03 483.89 484.46 483.78 486.9C480.22 486.82 476.66 486.75 473.11 486.68C471.75 479.12 472.93 470.37 472.78 462.64C472.64 455.45 473.58 451.03 465.35 449.17C461.4 448.67 457.55 448.91 453.83 450.31C453.82 455.14 453.82 459.97 453.81 464.79C453.81 469.73 453.81 474.66 453.81 479.59C453.82 481.86 453.83 484.12 453.84 486.39C449.99 486.45 446.14 486.51 442.29 486.56C442.2 484.24 442.1 481.91 442 479.59C442 474.66 441.99 469.73 441.99 464.79C441.99 459.66 442 454.52 442.01 449.38C442.01 444.66 442.01 439.93 442.01 435.21C442.1 430.73 442.2 426.25 442.29 421.77C446.15 421.91 450 422.04 453.85 422.18ZM639.44 422.17C639.42 426.31 639.4 430.45 639.38 434.59C639.38 439.73 639.38 444.86 639.38 450C639.38 454.73 639.38 459.45 639.37 464.18C639.37 469.52 639.37 474.86 639.37 480.21C639.2 482.46 639.02 484.72 638.84 486.97C635.38 486.96 631.92 486.95 628.46 486.94C628.29 484.49 628.12 482.04 627.96 479.59C627.95 474.66 627.95 469.73 627.95 464.79C627.95 459.86 627.94 454.93 627.94 450C627.94 444.86 627.94 439.73 627.94 434.59C628.11 430.25 628.29 425.9 628.46 421.56C632.12 421.76 635.78 421.96 639.44 422.17ZM663.89 421.69C663.96 425.99 664.03 430.29 664.09 434.59C664.09 439.73 664.09 444.86 664.09 450C664.09 454.93 664.1 459.86 664.1 464.79C664.1 469.73 664.11 474.66 664.11 479.59C664 482.03 663.89 484.46 663.78 486.9C660.22 486.82 656.66 486.75 653.11 486.68C653.11 465.05 653.11 443.43 653.12 421.8C656.71 421.76 660.3 421.72 663.89 421.69ZM675.57 430.16C674.2 427.58 674.33 425.64 675.66 423.07C679.33 422.22 685.2 419.97 685.91 426.3C686.47 431.28 680.87 432.35 677.32 431.2C680.85 430.63 682.45 430.88 685.08 428.12C685.06 427.09 685.04 426.06 685.02 425.03C683.84 424.05 682.65 423.08 681.47 422.1C677.19 422.46 673.29 425.83 676.96 429.97C676.25 430.51 676.66 430.62 675.57 430.16ZM678.21 424.35C679.47 424.35 680.74 424.35 682 424.35C682 425.76 682 427.17 682 428.58C680.24 427.85 679.7 427.73 678.21 428.73C678.21 427.27 678.21 425.81 678.21 424.35ZM239.79 438.88C243.18 439.81 246.58 440.74 249.97 441.67C250.04 444.61 250.11 447.56 250.19 450.5C247.34 450 244.49 449.51 241.64 449.02C230.71 447 223.57 453.63 225.49 464.79C225.24 473.95 230.85 478.66 239.79 477.81C243.18 477.2 246.58 476.6 249.97 475.99C250.05 478.85 250.14 481.71 250.23 484.57C250.1 484.86 249.96 485.15 249.82 485.45C246.48 486.24 243.14 487.03 239.79 487.82C234.38 487.65 229.95 487.06 224.77 485.77C222.55 483.71 220.33 481.65 218.1 479.59C215.63 474.58 214.41 470.39 213.85 464.79C214.22 459.52 214.84 455.12 216.32 450.04C219.01 446.13 221.64 443.83 225.26 440.85C230.27 439.88 234.45 438.55 239.79 438.88ZM284.79 438.69C285.1 438.76 285.41 438.83 285.72 438.89C285.77 442.08 285.82 445.27 285.86 448.46C285.51 448.59 285.15 448.73 284.79 448.86C282.74 448.91 280.68 448.96 278.63 449C276.85 449.44 275.06 449.87 273.28 450.31C273.18 455.06 273.08 459.81 272.98 464.56C272.97 469.76 272.96 474.96 272.94 480.16C272.97 482.23 273 484.3 273.03 486.37C269.32 486.47 265.61 486.58 261.9 486.68C261.67 484.32 261.44 481.95 261.22 479.59C261.22 474.66 261.22 469.73 261.22 464.79C261.22 459.86 261.21 454.93 261.21 450C261.41 441.66 262.44 441.86 270 439.55C274.93 439.27 279.86 438.98 284.79 438.69ZM360 438.88C364.92 438.9 369.85 438.93 374.77 438.96C378.96 441.18 383.02 441.61 385.83 446.1C390.7 453.88 388.14 466.24 388.14 474.97C388.14 478.75 388.98 483 388.02 486.68C384.54 486.8 381.05 486.92 377.57 487.04C374.51 478.59 379.32 462.21 376.66 453.42C374.85 447.43 362.68 447.72 358.67 450.92C358.39 462.9 358.12 474.87 357.84 486.85C354.35 486.81 350.86 486.78 347.36 486.74C345.72 481.21 346.97 461.64 346.97 454.62C346.97 450.99 346.23 446.36 348.64 443.28C351.34 439.82 356.23 440.1 360 438.88ZM419.79 438.72C423.58 439.32 428.45 439.48 431.66 441.68C431.82 444.47 431.99 447.26 432.15 450.05C432.04 450.24 431.93 450.43 431.82 450.62C429.04 450.08 426.27 449.54 423.49 449.01C413.71 447.42 408.24 450.85 407.23 460.76C407.02 462.78 406.82 464.96 407.4 466.84C407.58 474.07 412.68 478.45 419.79 477.81C424.11 478.44 427.74 476.66 431.82 475.96C431.92 477.35 432.02 478.74 432.12 480.12C432.02 481.77 431.92 483.42 431.82 485.06C427.83 486.08 423.84 487.11 419.85 488.13C417.14 487.84 414.3 487.97 411.61 487.37C409.32 486.85 407.28 485.58 405.07 485.04C393.4 472.82 394.43 465.87 398.09 450C400.37 447.08 402.43 444.6 405 441.96C410.08 440.02 414.26 438.84 419.79 438.72ZM562.19 448.86C559.74 448.79 557.79 449.08 555.66 450.31C553.9 454.21 555.02 460.5 555.05 464.79C555.04 469.73 555.04 474.66 555.04 479.59C554.91 481.95 554.78 484.32 554.65 486.68C551.15 486.78 547.64 486.87 544.13 486.97C543.95 474.65 543.78 462.32 543.6 450C543.79 448.07 543.15 445.07 544.11 443.34C545.86 440.14 552.34 439.72 555.41 439.36C559.71 439.31 564.02 439.26 568.32 439.21C568.26 442.29 568.2 445.38 568.14 448.46C566.16 448.59 564.17 448.72 562.19 448.86ZM599.79 438.88C606.09 441.04 609.93 442.81 614.55 447.72C614.74 448.08 614.94 448.43 615.14 448.79C615.55 450.19 616.45 451.47 616.85 452.88C618.15 457.46 617.88 462.01 618.23 466.65C616.46 478.63 612.08 485.21 599.79 487.76C594.76 487.78 590.45 487.48 585.6 486.19C583.14 484.48 580.67 482.77 578.2 481.06C575.04 474.24 574.3 472.46 573.01 464.79C573.41 459.6 574 454.96 575.67 450C578.05 445.73 581.12 443.53 585 440.74C587.2 440.32 589.32 439.43 591.54 439.06C594.27 438.6 597.06 439.04 599.79 438.88ZM298.99 439.54C301.22 439.64 303.45 439.73 305.68 439.83C305.8 443.01 305.92 446.2 306.04 449.38C306.04 455.72 304.45 468.44 307.49 473.87C310.19 478.66 320.55 478.66 323.68 474.36C325.69 471.59 325.23 468.02 325.25 464.79C325.25 459.86 325.25 454.93 325.24 450C325.42 446.62 325.61 443.24 325.79 439.86C326.9 439.75 328.01 439.64 329.12 439.53C331.47 439.63 333.82 439.73 336.17 439.83C336.37 443.01 336.57 446.2 336.77 449.38C336.6 463.39 339.49 473.31 329.85 484.49C323.72 486.66 320.54 487.63 313.77 487.81C308.92 487.62 304.08 486.53 300.26 483.36C299.23 482.04 298.2 480.73 297.17 479.42C296.36 475.58 295.56 471.74 294.76 467.9C294.74 458.6 294.72 449.3 294.7 439.99C296.13 439.84 297.56 439.69 298.99 439.54ZM496.15 439.55C498.34 439.67 500.52 439.79 502.71 439.91C506.24 450.36 509.78 460.81 513.31 471.27C515.63 464.18 517.94 457.1 520.26 450.01C521.94 447.01 521.67 441.11 524.81 439.46C528.33 439.6 531.85 439.75 535.38 439.89C528.72 458.05 522.05 476.22 515.39 494.38C513.93 497.98 512.47 501.58 511.01 505.17C510.6 505.32 510.2 505.47 509.79 505.62C506.28 505.47 502.77 505.32 499.25 505.17C500.51 501.78 501.76 498.39 503.02 495C506.39 490.53 508.01 484.38 505.54 479.38C501.64 469.37 497.74 459.35 493.85 449.34C492.9 446.22 491.94 443.11 490.99 439.99C492.71 439.84 494.43 439.69 496.15 439.55ZM590.55 449.22C584.97 451.83 584.11 459.34 584.93 464.79C584.16 472.88 588.13 478.5 596.4 478.37C598.96 478.33 601.82 477.71 603.59 475.71C607.7 471.04 608.05 455.86 603.8 451.22C601.85 449.1 599.15 448.63 596.4 448.52C594.47 448.44 592.29 448.46 590.55 449.22Z"/></svg>` },
    "spotify":        { color: "#1DB954", logo: `<svg viewBox="0 0 24 24" fill="#fff" width="40" height="40"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.586 14.424a.622.622 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.622.622 0 1 1-.277-1.215c3.809-.871 7.077-.496 9.712 1.115a.623.623 0 0 1 .207.857zm1.223-2.723a.78.78 0 0 1-1.072.257c-2.688-1.652-6.786-2.131-9.965-1.166a.78.78 0 1 1-.452-1.492c3.632-1.102 8.147-.568 11.232 1.329a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 9.15 9.375 8.97 6.297 9.906a.936.936 0 1 1-.543-1.79c3.532-1.072 9.404-.865 13.115 1.338a.936.936 0 0 1-.955 1.612z"/></svg>` },
    "plex":           { color: "#E5A00D", icon: "▶" },
    "twitch":         { color: "#9146FF", icon: "🎮" },
    "default":        { color: "#374151", logo: `<svg viewBox="0 0 24 24" width="40" height="40" fill="#fff"><path d="M8.707 2.293l3.293 3.292l3.293 -3.292a1 1 0 0 1 1.32 -.083l.094 .083a1 1 0 0 1 0 1.414l-2.293 2.293h4.586a3 3 0 0 1 3 3v9a3 3 0 0 1 -3 3h-14a3 3 0 0 1 -3 -3v-9a3 3 0 0 1 3 -3h4.585l-2.292 -2.293a1 1 0 0 1 1.414 -1.414m10.293 5.707h-2a1 1 0 0 0 -1 1v9a1 1 0 0 0 1 1h2a1 1 0 0 0 1 -1v-9a1 1 0 0 0 -1 -1" /><path d="M18 14a1 1 0 0 1 .993 .883l.007 .127a1 1 0 0 1 -1.993 .117l-.007 -.127a1 1 0 0 1 1 -1" /><path d="M18 11a1 1 0 0 1 .993 .883l.007 .127a1 1 0 0 1 -1.993 .117l-.007 -.127a1 1 0 0 1 1 -1" /></svg>` }
};

function chromecastApplyFallback(appName) {
    const key = (appName || "").toLowerCase();
    const style = CHROMECAST_APP_STYLES[key] || CHROMECAST_APP_STYLES["default"];

    chromecastClearImage(); // pas d'image ici : on repasse le calque flouté à vide

    const bg = document.getElementById("chromecastBg");
    bg.style.backgroundImage = "none";
    // Dégradé doux (glow) teinté de la couleur de la plateforme sur fond sombre,
    // plutôt qu'un aplat uni — même esprit que l'écran "aucune reco" du widget
    bg.style.background = `radial-gradient(ellipse at 50% 38%, ${style.color}77, #11151c 78%)`;
    bg.style.backgroundColor = "#11151c";
    if (style.logo) {
        bg.innerHTML = style.logo;
    } else {
        bg.textContent = style.icon;
    }
    bg.style.display = "flex";
    bg.style.alignItems = "center";
    bg.style.justifyContent = "center";
    bg.style.fontSize = "48px";
    bg.style.filter = "drop-shadow(0 4px 12px rgba(0,0,0,0.45))";
}

function chromecastClearFallback() {
    const bg = document.getElementById("chromecastBg");
    bg.innerHTML = "";
    bg.style.background = "";
    bg.style.backgroundColor = "#374151";
    bg.style.filter = "";
}

// Pose une image "en entier" (pas de recadrage → pas de perte de contenu),
// avec un calque flouté et agrandi derrière pour combler les bords/bandes
// noires plutôt que de laisser du vide ou un aplat uni (technique Spotify/
// Apple Music). Centralise tous les endroits qui posent une image de fond.
function chromecastSetImage(url) {
    const bg = document.getElementById("chromecastBg");
    const blur = document.getElementById("chromecastBgBlur");
    bg.style.backgroundImage = `url(${url})`;
    bg.style.backgroundSize = "contain";
    bg.style.backgroundRepeat = "no-repeat";
    bg.style.backgroundColor = "transparent"; // sinon le gris opaque cache le calque flouté en dessous
    blur.style.backgroundImage = `url(${url})`;
    const expectedImage = bg.style.backgroundImage; // valeur normalisée par le navigateur, pour comparaison fiable plus bas

    // Tentative de recadrage des bandes noires en tâche de fond (voir plus
    // bas) : remplace l'image par une version recadrée si des bandes sont
    // détectées. Ne bloque jamais l'affichage — l'image posée ci-dessus
    // reste visible pendant l'analyse, et le flou en dessous reste le filet
    // de sécurité si le recadrage échoue ou n'est pas nécessaire.
    chromecastAutoCropLetterbox(url).then(croppedUrl => {
        if (!croppedUrl) return;
        // On vérifie que l'image affichée n'a pas changé entre-temps
        // (nouvelle vidéo, veille...) avant d'appliquer le résultat
        if (bg.style.backgroundImage !== expectedImage) return;
        bg.style.backgroundImage = `url(${croppedUrl})`;
    });
}

// Détecte des bandes noires (quasi-noires) en haut/bas d'une image et
// renvoie une version recadrée en data URL, ou null si rien à recadrer /
// si l'analyse échoue (image bloquée par CORS, notamment pour les
// vignettes YouTube posées en URL directe plutôt qu'en blob).
async function chromecastAutoCropLetterbox(url) {
    try {
        const img = new Image();
        img.crossOrigin = "anonymous"; // nécessaire pour lire les pixels d'une image cross-origin
        const loaded = new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });
        img.src = url;
        await loaded;

        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return null;

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        let pixels;
        try {
            pixels = ctx.getImageData(0, 0, w, h).data; // lève une erreur si l'image est "tainted" (CORS)
        } catch (e) {
            return null; // repli silencieux sur le flou déjà en place
        }

        const BLACK_THRESHOLD = 18; // luminance moyenne (0-255) en dessous de laquelle une ligne est considérée noire
        const rowIsBlack = y => {
            let sum = 0, count = 0;
            for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 40))) { // échantillonnage, pas besoin de chaque pixel
                const i = (y * w + x) * 4;
                sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
                count++;
            }
            return (sum / count) < BLACK_THRESHOLD;
        };

        let top = 0;
        while (top < h / 2 && rowIsBlack(top)) top++;
        let bottom = h - 1;
        while (bottom > h / 2 && rowIsBlack(bottom)) bottom--;

        const cropped = h - (top + (h - 1 - bottom));
        // On ne recadre que si les bandes représentent une part significative
        // de l'image (évite de rogner une scène juste naturellement sombre)
        if (top + (h - 1 - bottom) < h * 0.04 || cropped < h * 0.5) return null;

        const outCanvas = document.createElement("canvas");
        outCanvas.width = w;
        outCanvas.height = cropped;
        outCanvas.getContext("2d").drawImage(img, 0, top, w, cropped, 0, 0, w, cropped);
        return outCanvas.toDataURL("image/jpeg", 0.85);
    } catch (err) {
        return null; // toute erreur → on garde simplement l'image + le flou tels quels
    }
}

function chromecastClearImage() {
    const bg = document.getElementById("chromecastBg");
    const blur = document.getElementById("chromecastBgBlur");
    bg.style.backgroundImage = "none";
    bg.style.backgroundSize = ""; // revient au "cover" par défaut de .spotify-bg
    bg.style.backgroundRepeat = "";
    bg.style.backgroundColor = ""; // revient au gris par défaut de .spotify-bg
    blur.style.backgroundImage = "none";
}

async function chromecastLoadImage(image) {
    try {
        const response = await fetch(image);
        if (!response.ok) throw new Error("HTTP " + response.status);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        // On libère l'ancienne image avant de poser la nouvelle
        if (chromecastImageObjectUrl) URL.revokeObjectURL(chromecastImageObjectUrl);
        chromecastImageObjectUrl = objectUrl;

        chromecastSetImage(objectUrl);
    } catch (err) {
        console.error("Chromecast image :", err);
    }
}

function chromecastShowIdle() {
    document.getElementById("chromecastIdle").style.display = "flex";
    document.getElementById("chromecastPlayer").style.display = "none";
    document.getElementById("chromecastBg").style.filter = "brightness(0.8)"; // affiche plus lumineuse qu'en lecture
    if (!chromecastRecsLoaded) {
        chromecastRecsLoaded = true; // évite de relancer les appels API à chaque poll (toutes les ~5-10s)
        chromecastLoadRecommendations();
    }
}

function chromecastShowPlayer() {
    document.getElementById("chromecastIdle").style.display = "none";
    document.getElementById("chromecastPlayer").style.display = "flex";
    document.getElementById("chromecastBg").style.filter = ""; // retour au réglage par défaut (plus sombre) pendant la lecture
    clearInterval(chromecastRecTimer);
    chromecastRecTimer = null;
}

function updateChromecast() {
    const data = haStatesFull[CHROMECAST_ENTITY_ID];
    if (!data) { chromecastWasPlaying = false; chromecastShowIdle(); return; }

    try {
        const attrs = data.attributes || {};

        // Rien en cours : appareil éteint/indisponible, OU en "idle" HA sans
        // aucune appli ouverte (écran d'accueil Chromecast / backdrop).
        // Si une appli est ouverte (app_name présent) — même sans vidéo lancée,
        // ex. sur le menu d'accueil YouTube — on affiche son fallback plutôt
        // que de rester sur les recos : "idle" côté HA veut souvent juste dire
        // "rien ne joue", pas "rien n'est ouvert".
        // Exception : Spotify (Spotify Connect) laisse app_name="Spotify" même
        // quand rien n'est réellement diffusé — on ne le traite jamais comme
        // "actif" sur la seule foi de app_name, sinon le widget reste bloqué
        // en permanence sur le fallback Spotify au lieu des recos.
        const trulyOff = ["off", "unavailable"].includes(data.state);
        const noAppOpen = !attrs.app_name && !attrs.media_title;
        const appIsSpotify = (attrs.app_name || "").toLowerCase() === "spotify";
        if (trulyOff || (["idle", "standby"].includes(data.state) && (noAppOpen || appIsSpotify))) {
            // Ce nettoyage ne doit se faire qu'une fois, à la transition
            // lecture → veille — sinon il efface à chaque poll l'image de la
            // reco déjà affichée (clignotement toutes les quelques secondes)
            if (chromecastWasPlaying) {
                chromecastLastImage = null;
                chromecastLastSearchedTitle = null;
                if (chromecastImageObjectUrl) {
                    URL.revokeObjectURL(chromecastImageObjectUrl);
                    chromecastImageObjectUrl = null;
                }
                chromecastClearFallback();
                chromecastClearImage();
            }
            chromecastWasPlaying = false;
            chromecastCurrentAttrs = null;
            chromecastShowIdle();
            return;
        }

        chromecastWasPlaying = true;
        chromecastShowPlayer();
        chromecastRecsLoaded = false; // on est en lecture : les recos seront à recalculer à la prochaine veille

        // Historique de visionnage YouTube (sert de base aux recommandations
        // affichées quand rien n'est diffusé — on retient aussi la chaîne pour
        // pouvoir recommander d'autres vidéos du même créateur)
        if (attrs.app_name && attrs.app_name.toLowerCase() === "youtube" && attrs.media_title) {
            chromecastRecordWatched(chromecastDecodeHtml(attrs.media_title));
        }

        document.getElementById("chromecastTitle").textContent = chromecastDecodeHtml(attrs.media_title) || chromecastDecodeHtml(attrs.app_name) || "—";

        // Sous-titre : artiste (musique) ou série. Si le titre affiché est déjà
        // le nom de l'appli (pas de media_title), on n'y remet pas app_name en double.
        const subtitle = attrs.media_artist || attrs.media_series_title || (attrs.media_title ? attrs.app_name : "") || "";
        document.getElementById("chromecastSubtitle").textContent = subtitle;

        setPlayPauseIcon(document.getElementById("chromecastPlayPause"), data.state === "playing");

        chromecastCurrentAttrs = attrs;
        chromecastCurrentAttrsFetchedAt = Date.now();
        chromecastCurrentState = data.state;
        chromecastRenderPlayerModal(); // tient le popup à jour s'il est ouvert

        // Image (jaquette / miniature), relative à l'URL de Home Assistant si besoin
        const image = attrs.entity_picture
            ? (attrs.entity_picture.startsWith("http") ? attrs.entity_picture : HA_CONFIG.url + attrs.entity_picture)
            : null;

        if (image) {
            if (image !== chromecastLastImage) {
                chromecastLastImage = image;
                chromecastLastSearchedTitle = null;
                chromecastClearFallback();
                chromecastLoadImage(image);
            }
        } else if (attrs.app_name && attrs.app_name.toLowerCase() === "youtube" && attrs.media_title) {
            // Pas d'entity_picture fournie par HA : on tente de retrouver la
            // vignette via une recherche YouTube sur le titre (une seule fois par titre)
            chromecastLastImage = null;
            if (attrs.media_title !== chromecastLastSearchedTitle) {
                chromecastLastSearchedTitle = attrs.media_title;
                chromecastApplyFallback(attrs.app_name); // affichage immédiat pendant la recherche

                const searchedTitle = attrs.media_title;
                chromecastSearchYoutubeThumbnail(searchedTitle).then((thumb) => {
                    // On ignore le résultat si le titre a changé entre-temps (évite les races)
                    if (thumb && chromecastLastSearchedTitle === searchedTitle) {
                        chromecastClearFallback();
                        // Pose directe en CSS (pas de fetch/blob) : i.ytimg.com ne renvoie
                        // pas toujours d'en-têtes CORS compatibles avec une lecture en blob
                        chromecastSetImage(thumb);
                    }
                });
            }
        } else {
            chromecastLastImage = null;
            chromecastLastSearchedTitle = null;
            if (chromecastImageObjectUrl) {
                URL.revokeObjectURL(chromecastImageObjectUrl);
                chromecastImageObjectUrl = null;
            }
            chromecastApplyFallback(attrs.app_name);
        }

    } catch (err) {
        console.error("Chromecast :", err);
        chromecastWasPlaying = false;
        chromecastCurrentAttrs = null;
        chromecastClearFallback();
        chromecastClearImage();
        chromecastShowIdle();
    }
}

// ─── Recommandations (affichées quand rien n'est diffusé) ────────────────────
//
// Deux sources :
//  - YouTube : à partir des chaînes les plus regardées récemment (déduites de
//    l'historique local des vidéos castées), on récupère leurs dernières
//    publications via l'API de recherche YouTube (channelId + order=date).
//  - Films/séries : selon les genres choisis dans les paramètres du widget,
//    via l'API publique TMDB (themoviedb.org) — limité aux titres inclus
//    dans l'abonnement Netflix, Prime Video, Disney+ ou Crunchyroll en France.

// Clé API TMDB — à créer gratuitement sur https://www.themoviedb.org
// (Paramètres du compte → API → demander une clé "Developer")
const TMDB_API_KEY = "COLLE_TA_CLE_TMDB_ICI";

const CHROMECAST_WATCH_HISTORY_KEY = "chromecast_watch_history";
const CHROMECAST_GENRE_PREFS_KEY = "chromecast_genre_prefs";
const CHROMECAST_WATCH_HISTORY_MAX = 15;

let chromecastRecsLoaded = false;
let chromecastRecsData = []; // reco actuellement chargées, indexées pour la popup d'infos
let chromecastRecIndex = 0;
let chromecastRecTimer = null;

// L'API YouTube (et parfois d'autres sources) renvoie du texte avec des
// entités HTML encodées littéralement (ex. "L&#39;idée" au lieu de "L'idée").
// On décode systématiquement tout texte venant de l'extérieur avant affichage.
function chromecastDecodeHtml(str) {
    if (!str) return str;
    const el = document.createElement("textarea");
    el.innerHTML = str;
    return el.value;
}

// Correspondance genre choisi ↔ identifiants de genre TMDB (différents entre
// films et séries pour certaines catégories, ex. Action & Aventure côté séries)
const CHROMECAST_GENRES = [
    { key: "comedie",      label: "Comédie",         icon: "😄", movieId: 35,  tvId: 35 },
    { key: "sf",            label: "Science-fiction", icon: "🚀", movieId: 878, tvId: 10765 },
    { key: "aventure",      label: "Aventure",        icon: "🗺️", movieId: 12,  tvId: 10759 },
    { key: "action",        label: "Action",          icon: "💥", movieId: 28,  tvId: 10759 },
    { key: "drame",         label: "Drame",           icon: "🎭", movieId: 18,  tvId: 18 },
    { key: "horreur",       label: "Horreur",         icon: "👻", movieId: 27,  tvId: 9648 }, // pas de genre "Horreur" côté séries TMDB, "Mystère" en repli
    { key: "animation",     label: "Animation",       icon: "🎨", movieId: 16,  tvId: 16 },
    { key: "documentaire",  label: "Documentaire",    icon: "🎥", movieId: 99,  tvId: 99 },
];

// Plateformes sur lesquelles limiter les recos (identifiants TMDB), et région
// pour laquelle vérifier la disponibilité en abonnement (flatrate)
const CHROMECAST_STREAMING_PROVIDERS = "8|119|337|283"; // Netflix | Prime Video | Disney+ | Crunchyroll
const CHROMECAST_WATCH_REGION = "FR";

function chromecastGetWatchHistory() {
    return storageGet(CHROMECAST_WATCH_HISTORY_KEY, []);
}

async function chromecastRecordWatched(title) {
    const history = chromecastGetWatchHistory();

    // Déjà en tête de l'historique (même titre) : rien à refaire
    if (history[0] && history[0].title === title) return;

    let entry = { title, channelId: null, channelTitle: null, videoId: null, timestamp: Date.now() };

    // On a déjà vu ce titre exact avant : on réutilise les infos de chaîne
    // connues plutôt que de refaire un appel API
    const known = history.find(h => h.title === title && h.channelId);
    if (known) {
        entry = { ...known, timestamp: Date.now() };
    } else if (YOUTUBE_API_KEY && !YOUTUBE_API_KEY.startsWith("COLLE_")) {
        // Résout la chaîne d'origine de la vidéo via une recherche par titre
        // (l'attribut HA ne donne que le titre, pas l'ID de la vidéo/chaîne)
        try {
            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&type=video&q=${encodeURIComponent(title)}&key=${YOUTUBE_API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();
            const item = data.items && data.items[0];
            if (item) {
                entry.channelId = item.snippet.channelId;
                entry.channelTitle = chromecastDecodeHtml(item.snippet.channelTitle);
                entry.videoId = item.id.videoId;
            }
        } catch (err) {
            console.error("Chromecast historique (résolution chaîne) :", err);
        }
    }

    const filtered = history.filter(h => h.title !== title);
    filtered.unshift(entry);
    storageSet(CHROMECAST_WATCH_HISTORY_KEY, filtered.slice(0, CHROMECAST_WATCH_HISTORY_MAX));
}

// Chaînes les plus regardées récemment, des plus fréquentes/récentes aux moins
function chromecastGetTopChannels(max = 2) {
    const history = chromecastGetWatchHistory();
    const counts = new Map(); // channelId -> { channelId, channelTitle, score }

    history.forEach((h, i) => {
        if (!h.channelId) return;
        const weight = history.length - i; // plus récent = plus de poids
        const existing = counts.get(h.channelId);
        if (existing) {
            existing.score += weight;
        } else {
            counts.set(h.channelId, { channelId: h.channelId, channelTitle: h.channelTitle, score: weight });
        }
    });

    return [...counts.values()].sort((a, b) => b.score - a.score).slice(0, max);
}

function chromecastGetGenrePrefs() {
    return storageGet(CHROMECAST_GENRE_PREFS_KEY, []);
}

function chromecastSetGenrePrefs(genres) {
    storageSet(CHROMECAST_GENRE_PREFS_KEY, genres);
}

// ── Paramètres : choix des genres préférés ──
function chromecastOpenGenreSettings() {
    chromecastRenderGenreChips();
    openWidgetModal("chromecast-genres");
}

function chromecastRenderGenreChips() {
    const container = document.getElementById("chromecastGenreChips");
    if (!container) return;
    const selected = chromecastGetGenrePrefs();

    container.innerHTML = CHROMECAST_GENRES.map(g => `
        <button type="button"
                class="genre-chip${selected.includes(g.key) ? ' selected' : ''}"
                onclick="chromecastToggleGenre('${g.key}')">
            <span>${g.icon}</span> ${g.label}
        </button>
    `).join("");
}

function chromecastToggleGenre(key) {
    const selected = chromecastGetGenrePrefs();
    const next = selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key];
    chromecastSetGenrePrefs(next);
    chromecastRenderGenreChips();
    chromecastRecsLoaded = false; // les recos changent avec les préférences : on les recalculera
}

// ── Construction des recommandations ──
async function chromecastLoadRecommendations() {
    try {
        const [youtubeRecs, tmdbRecs] = await Promise.all([
            chromecastFetchYoutubeRecs(),
            chromecastFetchTmdbRecs(),
        ]);

        chromecastRecsData = [...youtubeRecs, ...tmdbRecs].slice(0, 3);
        chromecastRenderRecs();
    } catch (err) {
        console.error("Chromecast recommandations :", err);
    }
}

async function chromecastFetchYoutubeRecs() {
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY.startsWith("COLLE_")) return [];

    const topChannels = chromecastGetTopChannels(2);
    const watchedVideoIds = new Set(chromecastGetWatchHistory().map(h => h.videoId).filter(Boolean));

    // Historique pas encore assez riche (chaînes pas encore résolues) : rien à proposer
    if (topChannels.length === 0) return [];

    try {
        const results = await Promise.all(topChannels.map(async channel => {
            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&type=video&order=date&channelId=${channel.channelId}&key=${YOUTUBE_API_KEY}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error("HTTP " + response.status);
            const data = await response.json();

            return (data.items || [])
                .filter(item => !watchedVideoIds.has(item.id.videoId)) // pas déjà vue
                .map(item => ({
                    type: "youtube",
                    title: chromecastDecodeHtml(item.snippet.title),
                    subtitle: chromecastDecodeHtml(item.snippet.channelTitle),
                    description: chromecastDecodeHtml(item.snippet.description),
                    image: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
                    publishedAt: item.snippet.publishedAt,
                }));
        }));

        // On alterne entre les chaînes plutôt que de mettre toute une chaîne à la suite
        const merged = [];
        const maxLen = Math.max(...results.map(r => r.length));
        for (let i = 0; i < maxLen; i++) {
            results.forEach(r => { if (r[i]) merged.push(r[i]); });
        }
        return merged.slice(0, 6);
    } catch (err) {
        console.error("Chromecast recos YouTube :", err);
        return [];
    }
}

async function chromecastFetchTmdbRecs() {
    if (!TMDB_API_KEY || TMDB_API_KEY.startsWith("COLLE_")) return [];

    const prefs = chromecastGetGenrePrefs();
    if (prefs.length === 0) return [];

    // Un genre choisi au hasard à chaque rechargement pour varier les propositions
    const genre = CHROMECAST_GENRES.find(g => g.key === prefs[Math.floor(Math.random() * prefs.length)]);
    if (!genre) return [];

    try {
        const [movies, shows] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/discover/movie?with_genres=${genre.movieId}&with_watch_providers=${CHROMECAST_STREAMING_PROVIDERS}&watch_region=${CHROMECAST_WATCH_REGION}&with_watch_monetization_types=flatrate&sort_by=popularity.desc&language=fr-FR&api_key=${TMDB_API_KEY}`).then(r => r.json()),
            fetch(`https://api.themoviedb.org/3/discover/tv?with_genres=${genre.tvId}&with_watch_providers=${CHROMECAST_STREAMING_PROVIDERS}&watch_region=${CHROMECAST_WATCH_REGION}&with_watch_monetization_types=flatrate&sort_by=popularity.desc&language=fr-FR&api_key=${TMDB_API_KEY}`).then(r => r.json()),
        ]);

        const movieRecs = (movies.results || []).slice(0, 3).map(m => ({
            type: "movie",
            genreLabel: genre.label,
            title: chromecastDecodeHtml(m.title),
            subtitle: (m.release_date || "").slice(0, 4),
            description: chromecastDecodeHtml(m.overview),
            rating: m.vote_average,
            image: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
        }));

        const tvRecs = (shows.results || []).slice(0, 3).map(s => ({
            type: "tv",
            genreLabel: genre.label,
            title: chromecastDecodeHtml(s.name),
            subtitle: (s.first_air_date || "").slice(0, 4),
            description: chromecastDecodeHtml(s.overview),
            rating: s.vote_average,
            image: s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : null,
        }));

        return [...movieRecs, ...tvRecs];
    } catch (err) {
        console.error("Chromecast recos TMDB :", err);
        return [];
    }
}

function chromecastRenderRecs() {
    // Réponse arrivée en retard (chromecastLoadRecommendations est async) alors
    // qu'une vraie lecture a démarré entre-temps : on n'écrase pas l'affiche du
    // widget en cours de lecture avec une image de recommandation périmée.
    if (document.getElementById("chromecastIdle").style.display === "none") return;

    const tap = document.getElementById("chromecastRecTap");
    const nav = document.getElementById("chromecastRecNav");
    const empty = document.getElementById("chromecastRecEmpty");
    if (!tap || !nav || !empty) return;

    clearInterval(chromecastRecTimer);
    chromecastRecTimer = null;

    if (chromecastRecsData.length === 0) {
        tap.style.display = "none";
        nav.style.display = "none";
        document.getElementById("chromecastRecBadge").style.display = "none";
        empty.style.display = "flex";
        chromecastClearImage();
        chromecastClearFallback();
        return;
    }

    empty.style.display = "none";
    tap.style.display = "flex";
    document.getElementById("chromecastRecBadge").style.display = "flex";
    nav.style.display = chromecastRecsData.length > 1 ? "flex" : "none";
    chromecastRecIndex = 0;
    chromecastRenderCurrentRec();

    // Défilement automatique toutes les 8s s'il y a plus d'une reco
    if (chromecastRecsData.length > 1) {
        chromecastRecTimer = setInterval(chromecastRecNext, 8000);
    }
}

const CHROMECAST_REC_EYEBROWS = { youtube: "Nouvelle vidéo", movie: "Film à regarder", tv: "Série à regarder" };

function chromecastRenderCurrentRec() {
    const rec = chromecastRecsData[chromecastRecIndex];
    if (!rec) return;

    // La reco devient le fond du widget, comme une affiche
    chromecastClearFallback();
    if (rec.image) {
        chromecastSetImage(rec.image);
    } else {
        chromecastClearImage();
    }

    document.getElementById("chromecastRecTitle").textContent = rec.title;

    const metaParts = rec.type === "youtube"
        ? [rec.subtitle]
        : [rec.subtitle, rec.genreLabel].filter(Boolean);
    document.getElementById("chromecastRecMeta").textContent = metaParts.join(" • ");

    document.getElementById("chromecastRecBadgeLabel").textContent = CHROMECAST_REC_EYEBROWS[rec.type] || "À regarder";

    const dots = document.getElementById("chromecastRecDots");
    dots.innerHTML = chromecastRecsData.map((_, i) =>
        `<span class="chromecast-rec-dot${i === chromecastRecIndex ? ' active' : ''}"></span>`
    ).join("");
}

function chromecastRecNext() {
    if (chromecastRecsData.length === 0) return;
    chromecastRecIndex = (chromecastRecIndex + 1) % chromecastRecsData.length;
    chromecastRenderCurrentRec();
}

function chromecastRecPrev() {
    if (chromecastRecsData.length === 0) return;
    chromecastRecIndex = (chromecastRecIndex - 1 + chromecastRecsData.length) % chromecastRecsData.length;
    chromecastRenderCurrentRec();
}

function chromecastShowRecInfo(index) {
    const rec = chromecastRecsData[index];
    if (!rec) return;

    const poster = document.getElementById("chromecastInfoPoster");
    poster.style.backgroundImage = rec.image ? `url('${rec.image}')` : "none";
    poster.textContent = rec.image ? "" : (rec.type === "youtube" ? "▶️" : "🎬");

    document.getElementById("chromecastInfoTitle").textContent = rec.title;

    const metaParts = [];
    if (rec.type === "youtube") {
        metaParts.push(rec.subtitle);
        if (rec.publishedAt) metaParts.push(new Date(rec.publishedAt).toLocaleDateString("fr-FR"));
    } else {
        metaParts.push(rec.type === "movie" ? "Film" : "Série");
        if (rec.subtitle) metaParts.push(rec.subtitle);
        if (rec.genreLabel) metaParts.push(rec.genreLabel);
        if (rec.rating) metaParts.push(`⭐ ${rec.rating.toFixed(1)}/10`);
    }
    document.getElementById("chromecastInfoMeta").textContent = metaParts.filter(Boolean).join(" · ");
    document.getElementById("chromecastInfoDesc").textContent = rec.description || "Pas de description disponible.";

    openWidgetModal("chromecast-info");
}

// ── Popup "lecteur en grand" (ouvert en cliquant sur le widget en cours de lecture) ──

function chromecastFormatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function chromecastRenderPlayerModal() {
    const modal = document.getElementById("modal-chromecast-player");
    if (!modal || !modal.classList.contains("visible") || !chromecastCurrentAttrs) return;

    const attrs = chromecastCurrentAttrs;

    // Même affiche que le widget principal (déjà chargée/mise en cache là-bas)
    const bgImage = document.getElementById("chromecastBg").style.backgroundImage;
    const resolvedImage = bgImage && bgImage !== "none" ? bgImage : "none";
    document.getElementById("chromecastPlayerModalPoster").style.backgroundImage = resolvedImage;
    document.getElementById("chromecastPlayerModalPosterBlur").style.backgroundImage = resolvedImage;

    document.getElementById("chromecastPlayerModalTitle").textContent =
        chromecastDecodeHtml(attrs.media_title) || chromecastDecodeHtml(attrs.app_name) || "—";

    const metaParts = [attrs.media_artist, attrs.media_series_title].filter(Boolean).map(chromecastDecodeHtml);
    document.getElementById("chromecastPlayerModalMeta").textContent = metaParts.join(" · ");

    const style = CHROMECAST_APP_STYLES[(attrs.app_name || "").toLowerCase()] || CHROMECAST_APP_STYLES["default"];
    const badge = document.getElementById("chromecastPlayerModalBadge");
    badge.textContent = chromecastDecodeHtml(attrs.app_name) || "Chromecast";
    badge.style.borderColor = style.color;
    badge.style.color = style.color;

    // Fond du popup teinté de la couleur de la plateforme (même esprit que le
    // fallback du widget principal), plutôt qu'un simple gris uni
    document.getElementById("modal-chromecast-player").style.setProperty(
        "--player-modal-glow",
        `radial-gradient(ellipse at 50% 0%, ${style.color}4d, #1f2937 65%)`
    );

    setPlayPauseIcon(document.getElementById("chromecastPlayerModalPlayPause"), chromecastCurrentState === "playing");

    // Barre de progression (si HA fournit la durée du média)
    const progress = document.getElementById("chromecastPlayerModalProgress");
    if (Number.isFinite(attrs.media_duration) && attrs.media_duration > 0) {
        let position = attrs.media_position || 0;
        if (chromecastCurrentState === "playing" && chromecastCurrentAttrsFetchedAt) {
            // Horloge locale uniquement des deux côtés (jamais media_position_updated_at,
            // qui vient de Home Assistant et peut être désynchro de l'appareil)
            position += Math.max(0, (Date.now() - chromecastCurrentAttrsFetchedAt) / 1000);
        }
        position = Math.min(position, attrs.media_duration);

        progress.style.display = "block";
        document.getElementById("chromecastPlayerModalProgressFill").style.width = `${(position / attrs.media_duration) * 100}%`;
        document.getElementById("chromecastPlayerModalPosition").textContent = chromecastFormatTime(position);
        document.getElementById("chromecastPlayerModalDuration").textContent = chromecastFormatTime(attrs.media_duration);
    } else {
        progress.style.display = "none";
    }
}

let chromecastProgressTicker = null;

function chromecastOpenPlayerModal() {
    if (!chromecastCurrentAttrs) return; // rien en lecture pour l'instant
    openWidgetModal("chromecast-player");
    chromecastRenderPlayerModal();

    // Même principe que Spotify : rafraîchit la barre localement toutes les
    // 500ms (pas de nouvel appel réseau) pour éviter l'effet de saut entre
    // deux polls HA (5s). S'arrête tout seul dès que le popup se ferme.
    clearInterval(chromecastProgressTicker);
    chromecastProgressTicker = setInterval(() => {
        const modal = document.getElementById("modal-chromecast-player");
        if (!modal || !modal.classList.contains("visible")) {
            clearInterval(chromecastProgressTicker);
            chromecastProgressTicker = null;
            return;
        }
        chromecastRenderPlayerModal();
    }, 500);
}

async function chromecastControl(service) {
    try {
        await fetch(`${HA_CONFIG.url}/api/services/media_player/${service}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ entity_id: CHROMECAST_ENTITY_ID })
        });
    } catch (err) {
        console.error("Chromecast contrôle :", err);
    }
    setTimeout(haFetchStates, 500);
}

function chromecastTogglePlay() {
    chromecastControl("media_play_pause");
}

updateChromecast();


// ─── Fond dynamique météo ────────────────────────────────────────────────────
// Images Unsplash : libres de droits, sans restriction de hotlink

const WEATHER_IMAGES = {
    "clear-day":    "weather-images/clear-day.jpg",
    "clear-night":  "weather-images/clear-night.jpg",
    "partly-day":   "weather-images/partly-day.jpg",
    "partly-night": "weather-images/partly-night.jpg",
    "cloudy-day":   "weather-images/cloudy-day.jpg",
    "cloudy-night": "weather-images/cloudy-night.jpg",
    "fog-day":      "weather-images/fog-day.jpg",
    "fog-night":    "weather-images/fog-night.jpg",
    "drizzle-day":  "weather-images/drizzle-day.jpg",
    "drizzle-night":"weather-images/drizzle-night.jpg",
    "rain-day":     "weather-images/rain-day.jpg",
    "rain-night":   "weather-images/rain-night.jpg",
    "snow-day":     "weather-images/snow-day.jpg",
    "snow-night":   "weather-images/snow-night.jpg",
    "storm":        "weather-images/storm.jpg",
};

function getWeatherImage(code, hour = new Date().getHours()) {
    const isNight = hour < 7 || hour >= 21;
    const t = isNight ? "night" : "day";

    if (code === 0)
        return WEATHER_IMAGES["clear-" + t];
    if ([1, 2].includes(code))
        return WEATHER_IMAGES["partly-" + t];
    if (code === 3)
        return WEATHER_IMAGES["cloudy-" + t];
    if ([45, 48].includes(code))
        return WEATHER_IMAGES["fog-" + t];
    if ([51, 53, 55].includes(code))
        return WEATHER_IMAGES["drizzle-" + t];
    if ([61, 63, 65].includes(code))
        return WEATHER_IMAGES["rain-" + t];
    if ([71, 73, 75, 77].includes(code))
        return WEATHER_IMAGES["snow-" + t];
    if ([95, 96, 99].includes(code))
        return WEATHER_IMAGES["storm"];

    return WEATHER_IMAGES["cloudy-" + t];
}

function applyWeatherBackground(code) {
    const card  = document.getElementById("widget-meteo");
    const modal = document.getElementById("modal-meteo");
    const url   = getWeatherImage(code);

    const img = new Image();
    img.onload = () => {
        [card, modal].forEach(el => {
            el.style.backgroundImage    = "url('" + url + "')";
            el.style.backgroundSize     = "cover";
            el.style.backgroundPosition = "center";
            el.style.animation          = "none";
        });
    };
    img.onerror = () => {
        [card, modal].forEach(el => {
            el.style.backgroundImage = "none";
            el.style.background      = "#1f2937";
        });
    };
    img.src = url;
}

//--------Favorits--------------------------------------------------------------

function getFavorites() {
    return storageGet("favorites", []);
}

function toggleFavorite(entityId) {
    let favorites = getFavorites();

    if (favorites.includes(entityId)) {
        favorites = favorites.filter(f => f !== entityId);
    } else {
        favorites.push(entityId);
    }

    storageSet("favorites", favorites);

    renderRooms();
    refreshFavoriteList();
}

function refreshFavoriteList() {

    const container = document.querySelector(".fav");

    container.innerHTML = `
        <span class="fav-title" style="color:white">
            ${ICON_STAR} Appareils favoris
        </span>
    `;

    const favorites = getFavorites().filter(id => HA_DEVICES[id]); // ignore favoris obsolètes

    if (favorites.length === 0) {
        container.innerHTML += `
            <p style="margin-top:20px;color:#94a3b8;">
                Aucun appareil favori
            </p>
        `;
        return;
    }

    favorites.forEach(entityId => {
        const info = HA_DEVICES[entityId];
        const on = haIsOn(entityId);

        const item = document.createElement("div");
        item.className = "device";
        item.innerHTML = `
            <div class="device-info">
                <span>${info.label}</span>
            </div>
            <button class="toggle ${on ? "active" : ""}"
                    onclick="haToggle('${entityId}')">${on ? "ON" : "OFF"}</button>
        `;

        container.appendChild(item);
    });
}

// ─── Réorganisation des widgets (appui long 5s + tap pour échanger) ─────────

const WIDGET_ORDER_KEY = "widgetOrder";
const LONG_PRESS_DURATION = 5000;  // 5 secondes
const MOVE_CANCEL_THRESHOLD = 10;  // px de tolérance avant d'annuler l'appui long

let selectedWidget = null;
let swapMode = false;

function applySavedWidgetOrder() {
    const container = document.querySelector(".top-row");
    if (!container) return;
    const saved = storageGet(WIDGET_ORDER_KEY, null);
    if (!saved) return;

    saved.forEach(key => {
        const el = container.querySelector(`[data-widget="${key}"]`);
        if (el) container.appendChild(el);
    });
}

function saveWidgetOrder() {
    const container = document.querySelector(".top-row");
    const order = [...container.children].map(el => el.dataset.widget);
    storageSet(WIDGET_ORDER_KEY, order);
}

function getSwapBanner() {
    let banner = document.getElementById("reorderBanner");
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "reorderBanner";
        banner.className = "reorder-banner";
        banner.innerHTML = `
            <span>👆 Touchez le widget avec lequel l'échanger</span>
            <button onclick="cancelWidgetSelection()">${ICON_X} Annuler</button>
        `;
        document.body.appendChild(banner);
    }
    return banner;
}

function selectWidgetForSwap(widget) {
    selectedWidget = widget;
    swapMode = true;
    widget.classList.add("selected-for-swap");
    document.querySelector(".top-row").classList.add("swap-mode");
    getSwapBanner().classList.add("visible");
    if (navigator.vibrate) navigator.vibrate(60);
}

function cancelWidgetSelection() {
    if (selectedWidget) selectedWidget.classList.remove("selected-for-swap");
    selectedWidget = null;
    swapMode = false;
    const container = document.querySelector(".top-row");
    if (container) container.classList.remove("swap-mode");
    const banner = document.getElementById("reorderBanner");
    if (banner) banner.classList.remove("visible");
}

function swapWidgets(a, b) {
    const parent = a.parentNode;
    const placeholder = document.createComment("swap-placeholder");
    parent.insertBefore(placeholder, a);
    parent.insertBefore(a, b);
    parent.insertBefore(b, placeholder);
    parent.removeChild(placeholder);
}

function initWidgetReorder() {
    applySavedWidgetOrder();

    document.querySelectorAll(".reorder-widget").forEach(widget => {
        let longPressTimer = null;
        let startX = 0, startY = 0;
        let suppressClick = false;

        const clearTimer = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };

        widget.addEventListener("pointerdown", (e) => {
            if (swapMode) return; // en mode échange, on attend un simple tap (voir "click")

            startX = e.clientX;
            startY = e.clientY;

            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                suppressClick = true; // ignore le click qui suivra le relâchement
                selectWidgetForSwap(widget);
            }, LONG_PRESS_DURATION);
        });

        widget.addEventListener("pointermove", (e) => {
            if (longPressTimer && Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_CANCEL_THRESHOLD) {
                clearTimer();
            }
        });

        widget.addEventListener("pointerup", clearTimer);
        widget.addEventListener("pointercancel", clearTimer);

        widget.addEventListener("click", (e) => {
            if (suppressClick) {
                suppressClick = false;
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            if (!swapMode) return;

            e.preventDefault();
            e.stopPropagation();

            if (widget === selectedWidget) {
                cancelWidgetSelection(); // retap sur le widget sélectionné = annuler
                return;
            }

            swapWidgets(selectedWidget, widget);
            saveWidgetOrder();
            cancelWidgetSelection();
        }, true); // capture: s'exécute avant les onclick inline (openWidgetModal, startMirror...)
    });
}

initWidgetReorder();

// Empêche l'ouverture des widgets (météo/transport/miroir) pendant le mode échange
const _openWidgetModal = openWidgetModal;
openWidgetModal = function (section) {
    if (swapMode) return;
    _openWidgetModal(section);
};

const _startMirror = startMirror;
startMirror = function () {
    if (swapMode) return;
    _startMirror();
};
