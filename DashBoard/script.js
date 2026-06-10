// ─── Horloge ────────────────────────────────────────────────────────────────

function updateClock() {
    const now = new Date();

    document.getElementById("time").textContent =
        now.toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit"
        });

    document.getElementById("date").textContent =
        now.toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long"
        });
}

setInterval(updateClock, 1000);
updateClock();


// ─── Météo ───────────────────────────────────────────────────────────────────

function getWeatherIcon(code) {
    if ([0].includes(code)) return "☀️";
    if ([1, 2, 3].includes(code)) return "⛅";
    if ([45, 48].includes(code)) return "🌫️";
    if ([51, 53, 55, 61, 63, 65].includes(code)) return "🌧️";
    if ([71, 73, 75, 77].includes(code)) return "❄️";
    if ([95, 96, 99].includes(code)) return "⛈️";
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

        document.getElementById("temp").textContent =
            Math.round(data.current.temperature_2m) + "°C";

        document.getElementById("feels").textContent =
            Math.round(data.current.apparent_temperature);

        document.getElementById("humidity").textContent =
            data.current.relative_humidity_2m;

        document.getElementById("weatherIcon").textContent =
            getWeatherIcon(data.current.weather_code);

        const forecastContainer = document.getElementById("forecast");
        forecastContainer.innerHTML = "";

        const currentHour = new Date().getHours();

        for (let i = 1; i <= 5; i++) {
            const hour = (currentHour + i) % 24;
            const temp = Math.round(data.hourly.temperature_2m[currentHour + i]);

            forecastContainer.innerHTML += `
                <div class="forecast-item">
                    <div class="forecast-hour">${hour}h</div>
                    <div class="forecast-temp">${temp}°</div>
                </div>
            `;
        }

    } catch (err) {
        console.error("Météo :", err);
        document.getElementById("temp").textContent = "⚠️";

    } finally {
        loader.classList.remove("visible");
        content.classList.remove("loading");
    }
}

function getLocation() {
    navigator.geolocation.getCurrentPosition(
        position => {
            getWeather(position.coords.latitude, position.coords.longitude);
            document.getElementById("city").textContent = "Position actuelle";
        },
        error => {
            console.error(error);
            getWeather(47.2172, -1.5534);
            document.getElementById("city").textContent = "Nantes";
        }
    );
}

getLocation();
setInterval(getLocation, 600000);


// ─── Boutons ON/OFF ──────────────────────────────────────────────────────────

function toggle(button) {
    if (button.classList.contains("active")) {
        button.classList.remove("active");
        button.textContent = "OFF";
    } else {
        button.classList.add("active");
        button.textContent = "ON";
    }
}

function allOff() {
    document.querySelectorAll(".toggle").forEach(button => {
        button.classList.remove("active");
        button.textContent = "OFF";
    });
}


// ─── Navigation ──────────────────────────────────────────────────────────────

function showPage(pageId, button) {
    document.querySelectorAll(".page").forEach(page => {
        page.style.display = "none";
    });
    document.getElementById(pageId).style.display = "block";
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.remove("active-nav");
    });
    button.classList.add("active-nav");
}


// ─── Plein écran ─────────────────────────────────────────────────────────────

function fullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}


// ─── Transports — Temps réel Naolib via plan.naolib.fr ──────────────────────

async function updateTransports() {
    const container = document.getElementById("transport-list");

    try {
        const response = await fetch("https://plan.naolib.fr/api/stop/logical/9630");
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();

        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();

        function toMin(hhmm) {
            const [h, m] = hhmm.split(":").map(Number);
            let total = h * 60 + m;
            if (total < nowMin - 120) total += 24 * 60; // passage minuit
            return total;
        }

        function waitLabel(hhmm) {
            const diff = toMin(hhmm) - nowMin;
            if (diff <= 0) return "À quai";
            if (diff < 60) return `${diff} min`;
            return hhmm;
        }

        // Tram 2 → Orvault Grand Val (line "2", direction 1)
        const t2 = data.departures?.["2"]?.["1"]?.hours || [];
        // Tram 3 → Marcel Paul (line "3", direction 1)
        const t3 = data.departures?.["3"]?.["1"]?.hours || [];

        const next2 = t2.filter(h => toMin(h.time) > nowMin).slice(0, 3);
        const next3 = t3.filter(h => toMin(h.time) > nowMin).slice(0, 3);

        let html = "";

        next2.forEach(h => {
            const rt = h.is_rt ? "🟢" : "⚪";
            html += `<div class="transport-row">
                <span class="line-badge" style="background:#e2001a;color:white">2</span>
                <span class="transport-dest">Orvault Grand Val</span>
                <span class="transport-time">${waitLabel(h.time)} ${rt}</span>
            </div>`;
        });

        next3.forEach(h => {
            const rt = h.is_rt ? "🟢" : "⚪";
            html += `<div class="transport-row">
                <span class="line-badge" style="background:#0069e2;color:white">3</span>
                <span class="transport-dest">Marcel Paul</span>
                <span class="transport-time">${waitLabel(h.time)} ${rt}</span>
            </div>`;
        });

        if (!html) {
            html = `<div class="transport-loading">🕐 Aucun passage immédiat.</div>`;
        }

        container.innerHTML = html;

    } catch (err) {
        console.error("Erreur transports :", err);
        container.innerHTML = `<div class="transport-error">⚠️ Impossible de charger les horaires.</div>`;
    }
}

updateTransports();
setInterval(updateTransports, 30000);
