// Vues personnalisées Google Agenda. Le jeton OAuth reste en mémoire.
const calendarState = { events: [], view: storageGet('calendar_view', 'month'), anchor: new Date(), selected: new Date(), token: '', expiry: 0, message: '', request: 0, controller: null };
const calendarDialog = document.createElement('dialog');
calendarDialog.id = 'calendar-dialog';
calendarDialog.setAttribute('aria-labelledby', 'cal-dialog-title');
calendarDialog.innerHTML = `<header class="cal-popup-header"><div><h2 id="cal-dialog-title">Votre agenda</h2><span class="cal-muted" id="cal-view-name"></span></div><div class="cal-actions"><button type="button" id="cal-switch" onclick="calendarSwitch()"></button><button type="button" onclick="calendarDialog.close()" aria-label="Fermer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></header><nav class="cal-navigation" aria-label="Dates du calendrier"><button type="button" onclick="calendarMove(-1)" aria-label="Période précédente">‹</button><h3 id="cal-period"></h3><button type="button" onclick="calendarMove(1)" aria-label="Période suivante">›</button><button type="button" onclick="calendarToday()">Aujourd’hui</button></nav><p id="cal-popup-status" class="cal-muted" role="status"></p><div id="cal-content"></div>`;
document.body.append(calendarDialog);
calendarDialog.addEventListener('click', event => { if (event.target === calendarDialog) { const r = calendarDialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) calendarDialog.close(); } });
calendarDialog.addEventListener('close', () => document.getElementById('widget-calendar').focus());

function calEscape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function calDate(date, options) { return date.toLocaleDateString('fr-FR', options); }
function calDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function calAdd(date, days) { const result = calDay(date); result.setDate(result.getDate() + days); return result; }
function calEvent(raw) {
    const allDay = !!raw.start?.date;
    const start = new Date(raw.start?.dateTime || (raw.start?.date ? raw.start.date + 'T00:00:00' : NaN));
    const end = new Date(raw.end?.dateTime || (raw.end?.date ? raw.end.date + 'T00:00:00' : NaN));
    return { title: raw.summary || 'Sans titre', location: raw.location || '', start, end, allDay };
}
function calOnDay(event, day) { return event.start < calAdd(day, 1) && event.end > calDay(day); }
function calTime(event) { const time = d => d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }); return event.allDay ? 'Toute la journée' : `${time(event.start)} – ${time(event.end)}`; }
function calEventMarkup(event) { return `<article class="cal-event"><time>${calEscape(calTime(event))}</time><h3>${calEscape(event.title)}</h3>${event.location ? `<p class="cal-muted">${calEscape(event.location)}</p>` : ''}</article>`; }
function calEventsFor(day) { return calendarState.events.filter(e => calOnDay(e, day)); }

function calendarRender() {
    const now = new Date();
    document.getElementById('calendar-today').textContent = calDate(now, {weekday:'short', day:'numeric', month:'long'});
    const upcoming = calendarState.events.filter(e => e.end > now).sort((a,b) => a.start-b.start);
    const next = upcoming[0];
    document.getElementById('calendar-next').innerHTML = next ? `<span class="cal-pill">${calEscape(calDate(next.start,{weekday:'long',day:'numeric',month:'long'}))} · ${calEscape(next.allDay ? 'Toute la journée' : next.start.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}))}</span><h3 class="cal-hero">${calEscape(next.title)}</h3><p class="cal-muted">${calEscape(calTime(next))}${next.location ? ' · '+calEscape(next.location) : ''}</p>${upcoming[1] ? `<div class="cal-next-line"><span class="cal-muted">Ensuite · ${calEscape(calDate(upcoming[1].start,{day:'numeric',month:'short'}))} · ${calEscape(calTime(upcoming[1]))}</span><strong>${calEscape(upcoming[1].title)}</strong><span aria-hidden="true">→</span></div>` : ''}${calendarState.message ? `<p class="cal-muted">${calEscape(calendarState.message)}</p>` : ''}` : `<p class="cal-empty">${calEscape(calendarState.message || 'Aucun rendez-vous dans les 90 prochains jours.')}</p>`;
    const month = calendarState.view !== 'three';
    document.getElementById('cal-view-name').textContent = month ? 'Mois et rendez-vous' : 'Trois jours';
    const toggle = document.getElementById('cal-switch');
    toggle.setAttribute('aria-label', month ? 'Afficher Trois jours' : 'Afficher Mois et rendez-vous');
    toggle.title = toggle.getAttribute('aria-label');
    toggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${month ? '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16"/>' : '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2M7 17h2M11 17h2"/>'}</svg>`;
    document.getElementById('cal-popup-status').textContent = calendarState.message;
    const anchor = calendarState.anchor;
    const content = document.getElementById('cal-content');
    if (month) {
        document.getElementById('cal-period').textContent = calDate(anchor,{month:'long',year:'numeric'});
        const first = new Date(anchor.getFullYear(),anchor.getMonth(),1);
        const count = new Date(anchor.getFullYear(),anchor.getMonth()+1,0).getDate();
        let grid = ['L','M','M','J','V','S','D'].map(d=>`<span class="cal-weekday">${d}</span>`).join('');
        grid += '<span></span>'.repeat((first.getDay()+6)%7);
        for(let d=1;d<=count;d++) {
            const date = new Date(anchor.getFullYear(),anchor.getMonth(),d);
            const selected = +date === +calDay(calendarState.selected);
            grid += `<button type="button" class="cal-date${selected?' selected':''}${+date===+calDay(now)?' today':''}" data-day="${d}" aria-pressed="${selected}" aria-label="${calEscape(calDate(date,{weekday:'long',day:'numeric',month:'long'}))}, ${calEventsFor(date).length} rendez-vous">${d}<span class="cal-dot">${calEventsFor(date).length ? '•' : ''}</span></button>`;
        }
        const events = calEventsFor(calendarState.selected);
        content.innerHTML = `<div class="cal-month-layout"><div class="cal-grid">${grid}</div><section class="cal-day-detail"><h3>${calEscape(calDate(calendarState.selected,{weekday:'long',day:'numeric'}))}</h3>${events.map(calEventMarkup).join('') || '<p class="cal-muted">Aucun rendez-vous ce jour.</p>'}</section></div>`;
        content.querySelectorAll('[data-day]').forEach(button => button.onclick = () => {calendarState.selected = new Date(anchor.getFullYear(),anchor.getMonth(),Number(button.dataset.day)); calendarRender();});
    } else {
        document.getElementById('cal-period').textContent = `${calDate(anchor,{day:'numeric',month:'short'})} – ${calDate(calAdd(anchor,2),{day:'numeric',month:'short',year:'numeric'})}`;
        content.innerHTML = `<div class="cal-three">${[0,1,2].map(offset=>{const day=calAdd(anchor,offset);const events=calEventsFor(day);return `<section><header class="cal-day-heading"><span class="cal-muted">${calEscape(calDate(day,{weekday:'long'}))}</span><strong>${day.getDate()}</strong><span class="cal-muted">${calEscape(calDate(day,{month:'long'}))}</span></header>${events.map(calEventMarkup).join('') || '<p class="cal-muted">Aucun rendez-vous</p>'}</section>`;}).join('')}</div>`;
    }
}

async function calendarLoad() {
    calendarState.controller?.abort();
    const request = ++calendarState.request;
    const controller = calendarState.controller = new AbortController();
    const source = storageGet('google_calendar','');
    const key = storageGet('calendar_api_key','');
    if (!source || (!key && (!calendarState.token || Date.now() >= calendarState.expiry))) {
        calendarState.events = [];
        calendarState.message = !source ? 'Configurez votre agenda dans les paramètres.' : 'Connectez Google Agenda dans les paramètres pour afficher vos rendez-vous.';
        calendarRender(); return;
    }
    calendarState.message = 'Chargement de l’agenda…'; calendarRender();
    try {
        const config = new URL(googleCalendarUrl(source));
        const today = calDay(new Date());
        const first = new Date(calendarState.anchor.getFullYear(), calendarState.anchor.getMonth(), 1);
        const end = new Date(calendarState.anchor.getFullYear(), calendarState.anchor.getMonth()+1,1);
        const min = new Date(Math.min(+first,+today));
        const max = new Date(Math.max(+end,+calAdd(today,90),+calAdd(calendarState.anchor,3)));
        const headers = calendarState.token && Date.now()<calendarState.expiry ? {Authorization:`Bearer ${calendarState.token}`} : {};
        const result = [];
        for (const id of config.searchParams.getAll('src')) {
            let page = '';
            do {
                const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`);
                const params = {timeMin:min.toISOString(),timeMax:max.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'2500'};
                if (!headers.Authorization) params.key=key;
                if(page) params.pageToken=page;
                url.search = new URLSearchParams(params);
                const response = await fetch(url,{headers,signal:controller.signal});
                if(!response.ok) throw new Error(response.status===401 ? 'Connexion Google expirée. Reconnectez-vous dans les paramètres.' : 'Agenda inaccessible. Vérifiez la connexion Google ou la clé API et les droits de partage dans les paramètres.');
                const data = await response.json();
                result.push(...(data.items||[]).filter(e=>e.status!=='cancelled').map(calEvent).filter(e=>Number.isFinite(+e.start)&&Number.isFinite(+e.end)));
                page=data.nextPageToken||'';
            } while(page);
        }
        if(request!==calendarState.request)return;
        calendarState.events=result.sort((a,b)=>a.start-b.start); calendarState.message='';
    } catch(error) {
        if(request!==calendarState.request)return;
        calendarState.events=[]; calendarState.message=error.message;
    }
    calendarRender();
}
function calendarOpen() { calendarRender(); if(!calendarDialog.open)calendarDialog.showModal(); }
function calendarSwitch() { calendarState.view=calendarState.view==='three'?'month':'three'; storageSet('calendar_view',calendarState.view); calendarRender(); calendarLoad(); }
function calendarMove(direction) { const a=calendarState.anchor; calendarState.anchor=calendarState.view==='three'?calAdd(a,direction*3):new Date(a.getFullYear(),a.getMonth()+direction,1); calendarState.selected=calDay(calendarState.anchor); calendarLoad(); }
function calendarToday() { calendarState.anchor=new Date();calendarState.selected=new Date();calendarLoad(); }
function renderGoogleCalendar() {
    document.getElementById('calendar-source').value=storageGet('google_calendar','');
    document.getElementById('calendar-client').value=storageGet('calendar_client','');
    document.getElementById('calendar-api-key').value=storageGet('calendar_api_key','');
    calendarLoad();
}
function saveGoogleCalendar(event) {
    event.preventDefault();
    try {
        const source=googleCalendarUrl(document.getElementById('calendar-source').value);
        storageSet('google_calendar',source);
        storageSet('calendar_client',document.getElementById('calendar-client').value.trim());
        storageSet('calendar_api_key',document.getElementById('calendar-api-key').value.trim());
        document.getElementById('calendar-status').textContent='Configuration enregistrée.';
        calendarLoad();
    } catch(error) {document.getElementById('calendar-status').textContent=error.message;}
}
function clearGoogleCalendar() {
    ['google_calendar','calendar_client','calendar_api_key'].forEach(key=>storageSet(key,''));
    calendarState.token='';calendarState.expiry=0;
    renderGoogleCalendar();
    document.getElementById('calendar-status').textContent='Agenda retiré de cet appareil.';
}
let calendarIdentityReady;
function calendarConnectionStatus(message) {
    document.getElementById('calendar-status').textContent=message;
    calendarState.message=message;
    calendarRender();
}
function calendarConfigure() {
    openWidgetModal('calendar-settings');
    calendarIdentity().catch(error=>calendarConnectionStatus(error.message));
}
function calendarIdentity() {
    if(window.google?.accounts?.oauth2)return Promise.resolve();
    if(!calendarIdentityReady)calendarIdentityReady=new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
        script.onload=resolve;script.onerror=()=>{calendarIdentityReady=null;script.remove();reject(new Error('Connexion Google indisponible.'));};document.head.append(script);
    });
    return calendarIdentityReady;
}
async function calendarConnect() {
    const status=document.getElementById('calendar-status');
    try {
        const client=document.getElementById('calendar-client').value.trim();
        if(!client)throw new Error('Renseignez l’identifiant client OAuth Google.');
        if(!window.google?.accounts?.oauth2){await calendarIdentity();calendarConnectionStatus('Google est prêt. Cliquez à nouveau sur Connecter Google Agenda dans les paramètres.');return;}
        const source=googleCalendarUrl(document.getElementById('calendar-source').value);
        const tokenClient=google.accounts.oauth2.initTokenClient({client_id:client,scope:'https://www.googleapis.com/auth/calendar.events.readonly',callback:response=>{
            if(response.error || !response.access_token){calendarConnectionStatus('Connexion Google refusée : '+(response.error_description || response.error || 'autorisation non reçue'));return;}
            calendarState.token=response.access_token;calendarState.expiry=Date.now()+Number(response.expires_in)*1000;
            storageSet('google_calendar',source);storageSet('calendar_client',client);status.textContent='Google Agenda connecté en lecture seule.';calendarLoad();
        },error_callback:error=>{calendarConnectionStatus(error.type==='popup_failed_to_open' ? 'La fenêtre Google est bloquée. Autorisez les popups pour ce site, puis reconnectez-vous.' : 'Connexion Google interrompue. Cliquez sur Connecter Google Agenda dans les paramètres.');}});
        tokenClient.requestAccessToken();
    }catch(error){calendarConnectionStatus(error.message);}
}
renderGoogleCalendar();
setInterval(()=>calendarLoad(),5*60*1000);
