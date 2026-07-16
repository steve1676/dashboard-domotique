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

// watchPosition = mise à jour automatique dès que la position change
navigator.geolocation.watchPosition(
    position => updateLocation(position.coords.latitude, position.coords.longitude),
    error => {
        console.error(error);
        getWeather(47.2172, -1.5534);
        document.getElementById("city").textContent = "Nantes";
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
);


// ─── Transports — Temps réel Naolib via plan.naolib.fr ──────────────────────
// Config par l'utilisateur (page Paramètres) : liste d'arrêts connus dans
// stops.json + choix ligne/direction par arrêt, stockés en localStorage.

const STOPS_JSON_URL   = "stops.json";
const NAOLIB_API_BASE  = "https://plan.naolib.fr/api/stop/logical/";

// Note sur la numérotation des logical_id (l'ID d'arrêt utilisé dans l'URL de l'API) :
// ce n'est ni alphabétique ni géographique global — les ID avancent par lots
// géographiques cohérents, dans l'ordre où chaque zone/ligne a été intégrée à la
// base Naolib. Quelques repères observés (juillet 2026) :
//   9613 à ~9662  : quartier Nantes centre/sud (Pirmil, Commerce, Mangin...)
//   9900-9917     : secteur Rezé/Vertou
//   9918-9982     : Orvault / Saint-Herblain
//   9983-10004    : Les Sorinières (commune plus au sud)
//   10056-10090   : Bouaye / secteur aéroport
//   10462-10473   : Le Cellier, Mauves (communes lointaines, périphérie du réseau)
// Les ID les plus élevés (10700+) correspondent aux ajouts les plus récents au
// référentiel (nouvelles communes desservies, petites lignes périurbaines).
// Utile pour deviner approximativement où chercher un arrêt manquant dans stops.json.

let knownStops = [];          // contenu de stops.json : [{id, label}, ...]
const stopDataCache = {};     // stopId -> dernière réponse de l'API (cache mémoire)

function getTransportRoutes() {
    return JSON.parse(localStorage.getItem("transport_routes_config") || "[]");
}

function saveTransportRoutes(routes) {
    localStorage.setItem("transport_routes_config", JSON.stringify(routes));
}

async function loadKnownStops() {
    try {
        const res = await fetch(STOPS_JSON_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        // Le fichier peut être soit un simple tableau [{id, label}, ...] (ancien format),
        // soit un objet { _notes, stops: [...] } (nouveau format, avec annotations).
        knownStops = Array.isArray(data) ? data : (data.stops || []);
    } catch (err) {
        console.error("Impossible de charger stops.json :", err);
        knownStops = [];
    }
    populateTransportStopSelect();
}

function populateTransportStopSelect() {
    const select = document.getElementById("new-transport-stop");
    if (!select) return;
    select.innerHTML = `<option value="">Choisir un arrêt...</option>` +
        knownStops.map(s => `<option value="${s.id}">${s.label}</option>`).join("");
}

async function fetchNaolibStop(stopId) {
    if (stopDataCache[stopId]) return stopDataCache[stopId];
    const res = await fetch(NAOLIB_API_BASE + stopId);
    if (!res.ok) throw new Error("HTTP " + res.status + " pour l'arrêt " + stopId);
    const data = await res.json();
    stopDataCache[stopId] = data;
    return data;
}

async function onTransportStopChange() {
    const stopSelect = document.getElementById("new-transport-stop");
    const lineSelect = document.getElementById("new-transport-line");
    const dirSelect  = document.getElementById("new-transport-direction");

    lineSelect.innerHTML = `<option value="">— Ligne —</option>`;
    dirSelect.innerHTML  = `<option value="">— Direction —</option>`;
    lineSelect.disabled = true;
    dirSelect.disabled  = true;

    const stopId = stopSelect.value;
    if (!stopId) return;

    try {
        delete stopDataCache[stopId]; // on force un fetch frais quand on configure
        const data = await fetchNaolibStop(stopId);
        const lines = data.linked_lines || [];
        lineSelect.innerHTML = `<option value="">— Ligne —</option>` +
            lines.map(l => `<option value="${l.id}">${l.number} — ${l.name}</option>`).join("");
        lineSelect.disabled = false;
    } catch (err) {
        console.error("Erreur chargement arrêt :", err);
        lineSelect.innerHTML = `<option value="">⚠️ Erreur de chargement</option>`;
    }
}

function onTransportLineChange() {
    const stopId = document.getElementById("new-transport-stop").value;
    const lineId = document.getElementById("new-transport-line").value;
    const dirSelect = document.getElementById("new-transport-direction");

    dirSelect.innerHTML = `<option value="">— Direction —</option>`;
    dirSelect.disabled = true;

    if (!stopId || !lineId) return;
    const data = stopDataCache[stopId];
    if (!data) return;

    const line = (data.linked_lines || []).find(l => String(l.id) === String(lineId));
    if (!line) return;

    dirSelect.innerHTML = `<option value="">— Direction —</option>` +
        (line.directions || []).map(d => `<option value="${d.direction}">${d.name}</option>`).join("");
    dirSelect.disabled = false;
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
    const lineNumber = lineSelect.options[lineSelect.selectedIndex].textContent.split(" — ")[0].trim();
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

    // Reset des selects pour un prochain ajout
    stopSelect.value = "";
    lineSelect.innerHTML = `<option value="">— Ligne —</option>`;
    lineSelect.disabled = true;
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
            <button class="phone-remove" onclick="removeTransportRoute('${r.id}')">✕</button>
        `;
        container.appendChild(row);
    });
}

function updateTransportWidgetTitle() {
    const routes = getTransportRoutes();
    const titleEl      = document.getElementById("transport-title");
    const titleModalEl = document.getElementById("transport-title-modal");

    let label = "🚌 Transport";
    if (routes.length > 0) {
        const uniqueStops = [...new Set(routes.map(r => r.stopLabel))];
        label = uniqueStops.length === 1 ? `🚌 ${uniqueStops[0]}` : "🚌 Transport";
    }

    if (titleEl)      titleEl.textContent = label;
    if (titleModalEl) titleModalEl.textContent = label;
}

async function updateTransports() {
    const container      = document.getElementById("transport-list");
    const modalContainer  = document.getElementById("transport-list-modal");

    updateTransportWidgetTitle();

    const routes = getTransportRoutes();

    if (routes.length === 0) {
        const emptyHtml = `<div class="transport-loading">⚙️ Configure au moins une ligne dans les Paramètres.</div>`;
        container.innerHTML = emptyHtml;
        modalContainer.innerHTML = emptyHtml;
        return;
    }

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

    try {
        // Un seul appel API par arrêt, même si plusieurs lignes y sont configurées
        const stopIds = [...new Set(routes.map(r => r.stopId))];
        const stopDataById = {};
        await Promise.all(stopIds.map(async id => {
            delete stopDataCache[id]; // toujours des horaires frais au refresh
            stopDataById[id] = await fetchNaolibStop(id);
        }));

        let merged = [];
        routes.forEach(r => {
            const data = stopDataById[r.stopId];
            if (!data) return;
            const hours = data.departures?.[r.lineNumber]?.[r.direction]?.hours || [];
            const next = hours.filter(h => toMin(h.time) > nowMin).slice(0, 2);
            next.forEach(h => merged.push({ ...h, line: r.lineNumber, dest: r.destLabel, color: r.color }));
        });

        merged.sort((a, b) => toMin(a.time) - toMin(b.time));

        if (!merged.length) {
            const emptyHtml = `<div class="transport-loading">🕐 Aucun passage immédiat.</div>`;
            container.innerHTML = emptyHtml;
            modalContainer.innerHTML = emptyHtml;
            return;
        }

        let html = "";
        merged.forEach(h => {
            const rt = h.is_rt ? "🟢" : "⚪";
            html += `<div class="transport-row">
                <span class="line-badge" style="background:${h.color};color:white">${h.line}</span>
                <span class="transport-dest">${h.dest}</span>
                <span class="transport-time">${waitLabel(h.time)} ${rt}</span>
            </div>`;
        });

        // Carte : seul le 1er passage visible
        container.innerHTML = html;
        const rows = container.querySelectorAll(".transport-row");
        if (rows.length > 0) rows[0].classList.add("visible");

        // Modale : tous les passages visibles
        modalContainer.innerHTML = html;

    } catch (err) {
        console.error("Erreur transports :", err);
        const errorHtml = `<div class="transport-error">⚠️ Impossible de charger les horaires.</div>`;
        container.innerHTML = errorHtml;
        modalContainer.innerHTML = errorHtml;
    }
}

loadKnownStops();
renderTransportRoutesList();
updateTransports();
setInterval(updateTransports, 30000);


// ─── Transports — Alertes trafic (infotrafic) ────────────────────────────────

const NAOLIB_INFOTRAFIC_URL = "https://plan.naolib.fr/api/infotrafic";

// Rend le texte HTML de la description de l'API en texte simple lisible
function stripHtmlToText(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/?strong>/gi, "")
        .replace(/<\/?span[^>]*>/gi, "");
    const text = (tmp.textContent || tmp.innerText || "").trim();
    return text.replace(/\n{2,}/g, "\n").trim();
}

async function updateInfotrafic() {
    const badge = document.getElementById("transport-alert-badge");
    const modalBox = document.getElementById("transport-alerts-modal");
    if (!badge || !modalBox) return;

    const routes = getTransportRoutes();
    if (!routes.length) {
        badge.style.display = "none";
        modalBox.innerHTML = "";
        return;
    }

    // Lignes actuellement configurées dans le dashboard (numéros, ex: "2", "C3")
    const myLines = new Set(routes.map(r => r.lineNumber));

    try {
        const res = await fetch(NAOLIB_INFOTRAFIC_URL, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const disruptions = data.disruptions || [];

        // Ne garde que les perturbations touchant au moins une des lignes suivies
        const relevant = disruptions.filter(d =>
            (d.lineIds || []).some(id => myLines.has(String(id)))
        );

        if (!relevant.length) {
            badge.style.display = "none";
            modalBox.innerHTML = "";
            return;
        }

        badge.style.display = "inline";

        let html = "";
        relevant.forEach(d => {
            const lineTags = (d.lineIds || [])
                .filter(id => myLines.has(String(id)))
                .map(id => `<span class="alert-line-tag" style="background:${lineColor(id)}">${id}</span>`)
                .join("");

            const description = stripHtmlToText(d.description || d.name || "");

            html += `<div class="transport-alert-item">
                <span class="alert-icon">⚠️</span>
                <div class="alert-content">
                    <div class="alert-lines">${lineTags}</div>
                    <div class="alert-title">${d.name || ""}</div>
                    <div>${description}</div>
                    <div class="alert-dates">${d.startAt || ""} → ${d.endAt || ""}</div>
                </div>
            </div>`;
        });

        modalBox.innerHTML = html;

    } catch (err) {
        console.error("Erreur infotrafic :", err);
        // Silencieux : une alerte trafic indisponible ne doit pas casser le reste du widget
    }
}

updateInfotrafic();
setInterval(updateInfotrafic, 5 * 60 * 1000); // 5 min, les perturbations changent peu souvent


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
            if (HA_DEVICES[entity.entity_id]) {
                haStates[entity.entity_id] = entity.state;
            }
        });

        haShowStatus(null);
        renderRooms();
        refreshFavoriteList();

    } catch (err) {
        console.error("Home Assistant :", err);
        haShowStatus("⚠️ Impossible de joindre Home Assistant.");
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
        haShowStatus("⚠️ Action impossible, nouvelle tentative...");
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
                            onclick="toggleFavorite('${d.entity_id}')">${isFav ? "★" : "☆"}</button>
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
setInterval(haFetchStates, 5000);


// ─── Batterie téléphones (via Home Assistant / app Companion) ───────────────

const BATTERY_THRESHOLD = 15;

function getPhones() {
    return JSON.parse(localStorage.getItem("phones_config") || "[]");
}

function savePhones(phones) {
    localStorage.setItem("phones_config", JSON.stringify(phones));
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
            <button class="phone-remove" onclick="removePhone('${p.id}')">✕</button>
        `;
        container.appendChild(row);
    });
}

async function fetchBatteryLevel(entityId) {
    try {
        const response = await fetch(`${HA_CONFIG.url}/api/states/${entityId}`, {
            headers: {
                "Content-Type": "application/json"
            }
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data  = await response.json();
        const level = parseInt(data.state, 10);
        return isNaN(level) ? null : level;
    } catch (err) {
        console.error("Batterie", entityId, ":", err);
        return null;
    }
}

async function renderBatteryBadges() {
    const container = document.getElementById("battery-badges");
    if (!container) return;

    const phones = getPhones();
    if (phones.length === 0) {
        container.innerHTML = "";
        return;
    }

    const results = await Promise.all(
        phones.map(async p => ({ ...p, level: await fetchBatteryLevel(p.entity_id) }))
    );

    container.innerHTML = "";
    results.forEach(p => {
        const badge = document.createElement("span");
        badge.className = "battery-badge";

        if (p.level === null) {
            badge.textContent = `🔋 ${p.label} --%`;
        } else {
            const icon = p.level <= BATTERY_THRESHOLD ? "🪫" : "🔋";
            badge.textContent = `${icon} ${p.label} ${p.level}%`;
            if (p.level <= BATTERY_THRESHOLD) badge.classList.add("low-battery");
        }

        container.appendChild(badge);
    });
}

renderPhonesList();
renderBatteryBadges();
refreshPhoneEntitySelect();
setInterval(renderBatteryBadges, 5000);
setInterval(refreshPhoneEntitySelect, 30000); // détecte les nouveaux capteurs périodiquement


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
    const saved = JSON.parse(localStorage.getItem('widgets_visibility') || '{}');
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

    const saved = JSON.parse(localStorage.getItem('widgets_visibility') || '{}');
    saved[widgetId] = visible;
    localStorage.setItem('widgets_visibility', JSON.stringify(saved));
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
    setInterval(spotifyUpdatePlayer, 5000);
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
    try {
        return JSON.parse(localStorage.getItem(YOUTUBE_THUMB_CACHE_KEY) || "{}");
    } catch {
        return {};
    }
}

function chromecastSaveThumbCache(cache) {
    try {
        localStorage.setItem(YOUTUBE_THUMB_CACHE_KEY, JSON.stringify(cache));
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

async function updateChromecast() {
    try {
        const response = await fetch(`${HA_CONFIG.url}/api/states/${CHROMECAST_ENTITY_ID}`, {
            headers: {
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) throw new Error("HTTP " + response.status);
        const data  = await response.json();
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
    setTimeout(updateChromecast, 500);
}

function chromecastTogglePlay() {
    chromecastControl("media_play_pause");
}

updateChromecast();
setInterval(updateChromecast, 5000);


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
    return JSON.parse(localStorage.getItem("favorites") || "[]");
}

function toggleFavorite(entityId) {
    let favorites = getFavorites();

    if (favorites.includes(entityId)) {
        favorites = favorites.filter(f => f !== entityId);
    } else {
        favorites.push(entityId);
    }

    localStorage.setItem("favorites", JSON.stringify(favorites));

    renderRooms();
    refreshFavoriteList();
}

function refreshFavoriteList() {

    const container = document.querySelector(".fav");

    container.innerHTML = `
        <span class="fav-title" style="color:white">
            ✩ Appareils favoris
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