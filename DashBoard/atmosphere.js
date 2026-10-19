// Carte Atmosphère : toutes les valeurs proviennent de la réponse Open-Meteo.
let atmosphereData = null;
let atmosphereView = 'hours';
let atmosphereSelection = 0;

function atmosphereCondition(code) {
    if (code === 0) return 'clear';
    if (code === 1 || code === 2) return 'partly';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if ([51,53,55].includes(code)) return 'drizzle';
    if ([56,57,66,67].includes(code)) return 'ice';
    if ([71,73,75,77,85,86].includes(code)) return 'snow';
    if ([95,96,99].includes(code)) return 'storm';
    if ([80,81,82].includes(code)) return 'showers';
    if ([61,63,65].includes(code)) return 'rain';
    return 'cloud';
}

function applyAtmosphereScene(card, code, night) {
    const condition = atmosphereCondition(code);
    card.dataset.condition = condition;
    card.dataset.atmosphere = night ? 'night' : ['rain','drizzle','showers','ice','storm'].includes(condition) ? 'rain' : ['cloud','fog'].includes(condition) ? 'cloud' : 'sun';
    card.querySelectorAll('.atmo-sky').forEach(sky => {
        if (sky.querySelector('.atmo-effects')) return;
        const effects = document.createElement('div');
        effects.className = 'atmo-effects';
        effects.innerHTML = '<span class="atmo-snow">✦ · ✦</span><span class="atmo-fog"></span><span class="atmo-bolt"></span><span class="atmo-stars">✧ · ✧</span>';
        sky.append(effects);
    });
}

function atmosphereIcon(code, night) {
    const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
    const cloud = '<path d="M6 17a4 4 0 1 1 1-7.9 6 6 0 0 1 11.5 2H19a3 3 0 0 1 0 6Z"/>';
    const condition = atmosphereCondition(code);
    const moon = '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>';
    const symbols = {
        clear: night ? moon : sun,
        partly: (night ? '<path d="M11 3a4 4 0 0 1-6 5 4 4 0 0 1 1-6 3 3 0 0 0 5 1Z"/>' : '<path d="M4 6a4 4 0 0 1 7-2"/>') + cloud,
        cloud,
        fog: cloud + '<path d="M3 20h18M6 23h12"/>',
        snow: cloud + '<path d="M7 20v3m-1.5-1.5h3M16 20v3m-1.5-1.5h3"/>',
        storm: cloud + '<path d="m13 17-3 4h4l-2 3"/>',
        drizzle: cloud + '<path d="M8 21h.01M14 21h.01M19 21h.01"/>',
        ice: cloud + '<path d="m8 20-1 2m6-2-1 2m6-2-1 2M4 21h.01"/>'
    };
    const shape = symbols[condition] || cloud + '<path d="m8 20-1 2m6-2-1 2m6-2-1 2"/>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + shape + '</svg>';
}

function weatherLabel(code) {
    return {clear:'Ciel dégagé',partly:'Éclaircies',cloud:'Ciel couvert',fog:'Brouillard',drizzle:'Bruine',ice:'Pluie verglaçante',snow:'Neige',storm:'Orages',showers:'Averses',rain:'Pluie'}[atmosphereCondition(code)];
}

function atmosphereEntries() {
    const d = atmosphereData;
    if (atmosphereView === 'days') return d.daily.time.slice(0, 4).map((time, i) => ({
        label: i === 0 ? "Aujourd’hui" : new Date(time + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'short'}),
        temp:d.daily.temperature_2m_max[i], min:d.daily.temperature_2m_min[i],
        code:d.daily.weather_code[i], rain:d.daily.precipitation_probability_max[i],
        wind:d.daily.wind_speed_10m_max[i], night:false, sunset:d.daily.sunset[i], time
    }));
    const start = Math.max(0, d.hourly.time.findIndex(t => t >= d.current.time.slice(0, 13) + ':00'));
    return d.hourly.time.slice(start, start + 6).map((time, i) => {
        const n = start + i;
        const day = d.daily.time.indexOf(time.slice(0,10));
        return {label:i === 0 ? 'Maint.' : time.slice(11,13) + ' h', time,
            temp:i === 0 ? d.current.temperature_2m : d.hourly.temperature_2m[n],
            feels:i === 0 ? d.current.apparent_temperature : d.hourly.apparent_temperature[n],
            code:i === 0 ? d.current.weather_code : d.hourly.weather_code[n],
            rain:d.hourly.precipitation_probability[n], wind:d.hourly.wind_speed_10m[n],
            min:d.daily.temperature_2m_min[day], max:d.daily.temperature_2m_max[day],
            night:!(i === 0 ? d.current.is_day : d.hourly.is_day[n]),sunset:d.daily.sunset[day]};
    });
}

function renderAtmosphere() {
    if (!atmosphereData) return;
    const entries = atmosphereEntries();
    const entry = entries[atmosphereSelection] || entries[0];
    const card = document.getElementById('atmo-popup');
    const fmt = v => Number.isFinite(v) ? Math.round(v) : '—';
    applyAtmosphereScene(card, entry.code, entry.night);
    document.getElementById('temp').textContent = fmt(entry.temp) + '°';
    document.getElementById('atmo-label').textContent = weatherLabel(entry.code);
    document.getElementById('atmo-caption').textContent = atmosphereView === 'days' ? entry.label + ' · Température maximale' : atmosphereSelection === 0 ? 'En ce moment' : entry.time.slice(11,16) + ' · Prévision';
    document.getElementById('atmo-feels').textContent = atmosphereView === 'days'
        ? '↓ ' + fmt(entry.min) + '° / ↑ ' + fmt(entry.temp) + '°'
        : 'Ressenti ' + fmt(entry.feels) + '° · ↓ ' + fmt(entry.min) + '° / ↑ ' + fmt(entry.max) + '°';
    document.getElementById('atmo-wind').textContent = fmt(entry.wind) + ' km/h';
    document.getElementById('atmo-rain').textContent = fmt(entry.rain) + ' %';
    document.getElementById('atmo-sunset').textContent = entry.sunset ? entry.sunset.slice(11,16).replace(':',' h ') : '—';
    document.getElementById('atmo-detail').textContent = entry.label + ' · ' + weatherLabel(entry.code) + ' · Pluie ' + fmt(entry.rain) + ' %';
    document.querySelectorAll('[data-atmo-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.atmoView === atmosphereView)));
    const list = document.getElementById('atmo-periods');
    list.style.setProperty('--periods', entries.length);
    list.replaceChildren(...entries.map((e,i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(i === atmosphereSelection));
        const label = document.createElement('span'); label.textContent = e.label;
        const icon = document.createElement('span'); icon.className = 'atmo-period-icon'; icon.innerHTML = atmosphereIcon(e.code,e.night); icon.setAttribute('aria-hidden','true');
        const value = document.createElement('strong'); value.textContent = fmt(e.temp) + '°';
        button.append(label,icon,value);
        button.addEventListener('click',() => {atmosphereSelection=i;renderAtmosphere();});
        return button;
    }));
}

function updateAtmosphere(data) {
    atmosphereData = data;
    const current = data.current;
    const card = document.getElementById('widget-meteo');
    applyAtmosphereScene(card, current.weather_code, !current.is_day);
    document.getElementById('atmo-widget-temp').textContent = Math.round(current.temperature_2m) + '°';
    document.getElementById('atmo-widget-label').textContent = weatherLabel(current.weather_code);
    document.getElementById('atmo-widget-feels').textContent = 'Ressenti ' + Math.round(current.apparent_temperature) + '°';
    document.getElementById('atmo-widget-limits').textContent = '↓ ' + Math.round(data.daily.temperature_2m_min[0]) + '° / ↑ ' + Math.round(data.daily.temperature_2m_max[0]) + '°';
    renderAtmosphere();
}

document.querySelectorAll('[data-atmo-view]').forEach(button => button.addEventListener('click', () => {
    atmosphereView=button.dataset.atmoView; atmosphereSelection=0; renderAtmosphere();
}));
