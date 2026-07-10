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

function getWeatherIcon(code) {
    const hour = new Date().getHours();
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
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code&hourly=temperature_2m`
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

        for (let i = 1; i <= 3; i++) {
            const hour = (currentHour + i) % 24;
            const temp = Math.round(data.hourly.temperature_2m[currentHour + i]);
            forecastContainer.innerHTML += `
                <div class="forecast-item">
                    <div class="forecast-hour">${hour}h</div>
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

async function updateTransports() {
    const container      = document.getElementById("transport-list");
    const modalContainer  = document.getElementById("transport-list-modal");

    try {
        const response = await fetch("https://plan.naolib.fr/api/stop/logical/9630");
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();

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

        const t2 = data.departures?.["2"]?.["1"]?.hours || [];
        const t3 = data.departures?.["3"]?.["1"]?.hours || [];

        const next2 = t2.filter(h => toMin(h.time) > nowMin).slice(0, 2);
        const next3 = t3.filter(h => toMin(h.time) > nowMin).slice(0, 2);

        // Fusion et tri chronologique
        const merged = [
            ...next2.map(h => ({ ...h, line: "2", dest: "Orvault Grand Val", color: "#e2001a" })),
            ...next3.map(h => ({ ...h, line: "3", dest: "Marcel Paul",       color: "#0069e2" }))
        ].sort((a, b) => toMin(a.time) - toMin(b.time));

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

updateTransports();
setInterval(updateTransports, 30000);


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

const CHROMECAST_ENTITY_ID = "media_player.latele_2";

let chromecastLastImage = null;
let chromecastImageObjectUrl = null;

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
            if (chromecastImageObjectUrl) {
                URL.revokeObjectURL(chromecastImageObjectUrl);
                chromecastImageObjectUrl = null;
            }
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

        if (image && image !== chromecastLastImage) {
            chromecastLastImage = image;
            chromecastLoadImage(image);
        } else if (!image) {
            chromecastLastImage = null;
            if (chromecastImageObjectUrl) {
                URL.revokeObjectURL(chromecastImageObjectUrl);
                chromecastImageObjectUrl = null;
            }
            document.getElementById("chromecastBg").style.backgroundImage = "none";
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

function getWeatherImage(code) {
    const hour = new Date().getHours();
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
    const card = document.getElementById("widget-meteo");
    const url  = getWeatherImage(code);

    const img = new Image();
    img.onload = () => {
        card.style.backgroundImage    = "url('" + url + "')";
        card.style.backgroundSize     = "cover";
        card.style.backgroundPosition = "center";
        card.style.animation          = "none";
    };
    img.onerror = () => {
        card.style.backgroundImage = "none";
        card.style.background      = "#1f2937";
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