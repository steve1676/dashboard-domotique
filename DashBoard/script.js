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
        forecastContainer.innerHTML = "";
        const currentHour = new Date().getHours();

        const totalHours = data.hourly.temperature_2m.length;
        const maxHours = Math.min(totalHours, currentHour + 24);
        for (let i = 1; currentHour + i < maxHours; i++) {
            const hour = (currentHour + i) % 24;
            const temp = Math.round(data.hourly.temperature_2m[currentHour + i]);
            const hCode = data.hourly.weather_code[currentHour + i];
            const hIcon = getWeatherIcon(hCode, hour);
            const hBg   = getWeatherImage(hCode, hour);
            const dayMark = hour === 0 ? `<div class="forecast-day">demain</div>` : "";
            forecastContainer.innerHTML += `
                <div class="forecast-item" style="background-image:url('${hBg}')">
                    ${dayMark}
                    <div class="forecast-hour">${hour}h</div>
                    <div class="forecast-icon">${hIcon}</div>
                    <div class="forecast-temp">${temp}°</div>
                </div>`;
        }

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
    transportInterval = setInterval(updateTransports, 30000);
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
// l'ordre de passage réel — ce fichier ne fournit pas de rang officiel.

const NAOLIB_GEOJSON_URL  = "https://plan.naolib.fr/map/logical_stops.geojson";
const NAOLIB_API_BASE     = "https://plan.naolib.fr/api/stop/logical/";
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
        const first = next[0];

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
        // Un seul appel API par arrêt, même si plusieurs lignes y sont configurées
        const stopIds = [...new Set(routes.map(r => r.stopId))];
        const stopDataById = {};
        await Promise.all(stopIds.map(async id => {
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
renderTransportRoutesList();
updateTransports();
transportInterval = setInterval(updateTransports, 30000);
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
const SPOTIFY_SCOPES       = "user-read-playback-state user-read-currently-playing user-modify-playback-state";

let spotifyLastTrackId = null;

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
    document.getElementById("spotifyPlayer").style.display = "none";
}

function spotifyShowPlayer() {
    document.getElementById("spotifyLoggedOut").style.display = "none";
    document.getElementById("spotifyPlayer").style.display = "flex";
}

// -- Lecture en cours --

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
            spotifyShowPlayer();
            document.getElementById("spotifyTitle").textContent = "Aucune lecture en cours";
            document.getElementById("spotifyArtist").textContent = "";
            return;
        }

        const data = await response.json();
        if (!data || !data.item) {
            spotifyShowPlayer();
            document.getElementById("spotifyTitle").textContent = "Aucune lecture en cours";
            document.getElementById("spotifyArtist").textContent = "";
            return;
        }

        spotifyShowPlayer();
        document.getElementById("spotifyTitle").textContent  = data.item.name;
        document.getElementById("spotifyArtist").textContent = data.item.artists.map(a => a.name).join(", ");
        document.getElementById("spotifyPlayPause").textContent = data.is_playing ? "⏸" : "▶";

        if (data.item.id !== spotifyLastTrackId) {
            spotifyLastTrackId = data.item.id;
            const art = data.item.album?.images?.[0]?.url;
            if (art) document.getElementById("spotifyAlbumArt").style.backgroundImage = `url(${art})`;
        }

    } catch (err) {
        console.error("Spotify player :", err);
    }
}

// -- Contrôles --

async function spotifyTogglePlay() {
    const token = await spotifyGetToken();
    if (!token) return;

    const btn = document.getElementById("spotifyPlayPause");
    const endpoint = btn.textContent === "⏸" ? "pause" : "play";

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

// Fallback visuel (couleur + icône) quand aucune image n'est disponible / trouvée
const CHROMECAST_APP_STYLES = {
    "youtube":        { color: "#FF0000", icon: "▶️" },
    "netflix":        { color: "#141414", icon: "🅽" },
    "disney+":        { color: "#113CCF", icon: "✦" },
    "prime video":    { color: "#00A8E1", icon: "▶" },
    "spotify":        { color: "#1DB954", icon: "🎵" },
    "plex":           { color: "#E5A00D", icon: "▶" },
    "twitch":         { color: "#9146FF", icon: "🎮" },
    "default":        { color: "#374151", icon: "📺" }
};

function chromecastApplyFallback(appName) {
    const key = (appName || "").toLowerCase();
    const style = CHROMECAST_APP_STYLES[key] || CHROMECAST_APP_STYLES["default"];

    const bg = document.getElementById("chromecastBg");
    bg.style.backgroundImage = "none";
    bg.style.backgroundColor = style.color;
    bg.textContent = style.icon;
    bg.style.display = "flex";
    bg.style.alignItems = "center";
    bg.style.justifyContent = "center";
    bg.style.fontSize = "48px";
}

function chromecastClearFallback() {
    const bg = document.getElementById("chromecastBg");
    bg.textContent = "";
    bg.style.backgroundColor = "#374151";
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

        document.getElementById("chromecastBg").style.backgroundImage = `url(${objectUrl})`;
    } catch (err) {
        console.error("Chromecast image :", err);
    }
}

function chromecastShowIdle() {
    document.getElementById("chromecastIdle").style.display = "flex";
    document.getElementById("chromecastPlayer").style.display = "none";
}

function chromecastShowPlayer() {
    document.getElementById("chromecastIdle").style.display = "none";
    document.getElementById("chromecastPlayer").style.display = "flex";
}

function updateChromecast() {
    const data = haStatesFull[CHROMECAST_ENTITY_ID];
    if (!data) { chromecastShowIdle(); return; }

    try {
        const attrs = data.attributes || {};

        // Rien en cours (éteint, en veille, ou pas de média chargé)
        if (["off", "idle", "unavailable", "standby"].includes(data.state) || !attrs.media_title) {
            chromecastShowIdle();
            chromecastLastImage = null;
            chromecastLastSearchedTitle = null;
            if (chromecastImageObjectUrl) {
                URL.revokeObjectURL(chromecastImageObjectUrl);
                chromecastImageObjectUrl = null;
            }
            chromecastClearFallback();
            document.getElementById("chromecastBg").style.backgroundImage = "none";
            return;
        }

        chromecastShowPlayer();

        document.getElementById("chromecastTitle").textContent = attrs.media_title || "—";

        // Sous-titre : artiste (musique), ou nom de l'appli/série selon le contenu
        const subtitle = attrs.media_artist || attrs.media_series_title || attrs.app_name || "";
        document.getElementById("chromecastSubtitle").textContent = subtitle;

        document.getElementById("chromecastPlayPause").textContent =
            data.state === "playing" ? "⏸" : "▶";

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
                        document.getElementById("chromecastBg").style.backgroundImage = `url(${thumb})`;
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
        chromecastShowIdle();
    }
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
