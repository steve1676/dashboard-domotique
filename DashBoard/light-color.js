/* Panneau couleur : une commande est envoyée à la fin de chaque geste. */
let lightColorState = null;
const lightColorDialog = document.createElement('section');
lightColorDialog.id = 'light-color-dialog';
lightColorDialog.setAttribute('aria-labelledby', 'light-color-title');
lightColorDialog.innerHTML = `
    <header class="lc-header"><div><h2 id="light-color-title">Couleur</h2><p id="lc-device"></p></div></header>
    <div class="lc-layout"><div class="lc-wheel" aria-label="Anneau extérieur : couleur ; anneau intérieur : température du blanc">
        <div class="lc-hue"></div><div class="lc-temp"></div><span class="lc-dot lc-hue-dot"></span><span class="lc-dot lc-temp-dot"></span><div class="lc-core"></div>
    </div><div class="lc-controls">
        <label>Couleur <output id="lc-hue-value"></output><input id="lc-hue" type="range" min="0" max="359" aria-label="Teinte en degrés"></label>
        <label id="lc-temp-label">Température <output id="lc-temp-value"></output><input id="lc-temp" type="range" step="1" aria-label="Température du blanc en kelvins"></label>
        <label id="lc-bright-label">Luminosité <output id="lc-bright-value"></output><input id="lc-bright" type="range" min="1" max="100" aria-label="Luminosité en pourcentage"></label>
    </div></div>
    <div class="lc-modes"><button type="button" data-lc-mode="color">Lumière colorée</button><button type="button" data-lc-mode="white">Lumière blanche</button></div>
    <div class="lc-preview"><span>Aperçu de l’éclairage</span><span id="lc-status" role="status"></span></div>`;

const lc = selector => lightColorDialog.querySelector(selector);

function mountLightColor() {
    const target = document.getElementById('device-inline-color');
    if (!target) return;
    target.append(lightColorDialog);
    if (lightColorState?.entityId === deviceDetailEntityId) return;
    openLightColor();
}

function openLightColor() {
    const entityId = deviceDetailEntityId;
    if (!entityId || !HA_DEVICES[entityId]) return;
    const a = haStatesFull[entityId]?.attributes || {};
    const rgb = a.rgb_color || [255, 255, 255];
    const [r,g,b] = rgb.map(v => v / 255), max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
    let hue = d ? (max === r ? (g-b)/d : max === g ? (b-r)/d+2 : (r-g)/d+4)*60 : 0;
    const minK = a.min_color_temp_kelvin || (a.max_mireds ? Math.ceil(1000000/a.max_mireds) : 2200);
    const maxK = a.max_color_temp_kelvin || (a.min_mireds ? Math.floor(1000000/a.min_mireds) : 6500);
    lightColorState = {entityId, hue: a.hs_color?.[0] ?? (hue+360)%360,
        temp: Math.max(minK,Math.min(maxK,a.color_temp_kelvin || (a.color_temp ? 1000000/a.color_temp : 3000))),
        bright: Math.max(1,Math.round((a.brightness ?? 255)/255*100)), minK,maxK,
        color: deviceSupportsColor(a), temperature: (a.supported_color_modes || []).includes('color_temp'), brightness: deviceSupportsBrightness(a),
        mode: a.color_mode === 'color_temp' || !deviceSupportsColor(a) ? 'white' : 'color', legacy: !a.min_color_temp_kelvin && !!a.min_mireds};
    lc('#lc-device').textContent = HA_DEVICES[entityId].label;
    lc('#lc-temp').min = minK; lc('#lc-temp').max = maxK;
    lc('#lc-temp-label').hidden = !lightColorState.temperature;
    lc('.lc-temp').hidden = lc('.lc-temp-dot').hidden = !lightColorState.temperature;
    lc('[data-lc-mode="white"]').hidden = !lightColorState.temperature;
    lc('#lc-bright-label').hidden = !lightColorState.brightness;
    lc('.lc-hue').hidden = lc('.lc-hue-dot').hidden = !lightColorState.color;
    lc('#lc-hue').parentElement.hidden = !lightColorState.color;
    lc('[data-lc-mode="color"]').hidden = !lightColorState.color;
    lc('.lc-modes').hidden = !(lightColorState.color && lightColorState.temperature);
    lightColorRender();
}

function lightColorRender() {
    const s = lightColorState; if (!s) return;
    const t = (s.temp-s.minK)/Math.max(1,s.maxK-s.minK);
    const color = s.mode === 'color' ? `hsl(${s.hue} 100% 65%)` : `rgb(${255-85*t},${185+45*t},${95+160*t})`;
    lightColorDialog.style.setProperty('--lc-color',color);
    lightColorDialog.style.setProperty('--lc-intensity',s.bright/100);
    for (const [key,value,unit] of [['hue',s.hue,'°'],['temp',s.temp,' K'],['bright',s.bright,' %']]) {
        lc('#lc-'+key).value = value;
        lc('#lc-'+key+'-value').textContent = Math.round(value).toLocaleString('fr-FR')+unit;
    }
    for (const [sel,angle,radius] of [['.lc-hue-dot',s.hue,44],['.lc-temp-dot',t*270,27]]) {
        const a = angle*Math.PI/180;
        lc(sel).style.left = (50+Math.sin(a)*radius)+'%';
        lc(sel).style.top = (50-Math.cos(a)*radius)+'%';
    }
    lc('.lc-hue-dot').style.background = `hsl(${s.hue} 100% 50%)`;
    lightColorDialog.querySelectorAll('[data-lc-mode]').forEach(b => b.setAttribute('aria-pressed',b.dataset.lcMode===s.mode));
    lc('#lc-status').textContent = (s.mode==='color'?'Couleur':'Blanc')+' · '+s.bright+' %';
}

async function lightColorCommit(brightnessOnly = false) {
    const s = {...lightColorState}; if (!s.entityId) return;
    const data = brightnessOnly ? {brightness_pct:s.bright} : s.mode==='color' ? {hs_color:[s.hue,100]} : s.legacy ? {color_temp:Math.round(1000000/s.temp)} : {color_temp_kelvin:Math.round(s.temp)};
    lc('#lc-status').textContent = 'Application…';
    try {
        const response = await fetch(`${HA_CONFIG.url}/api/services/light/turn_on`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entity_id:s.entityId,...data})});
        if (!response.ok) throw new Error('Commande refusée');
        haStates[s.entityId] = 'on';
        if(lightColorState?.entityId===s.entityId) lightColorRender();
        setTimeout(haFetchStates,450);
    } catch(error) {
        console.error('Commande couleur :',error);
        if(lightColorState?.entityId===s.entityId) lc('#lc-status').textContent = 'Commande impossible. Réessayez.';
    }
}

for (const key of ['hue','temp','bright']) {
    lc('#lc-'+key).addEventListener('input',event => {lightColorState[key]=Number(event.target.value);if(key!=='bright')lightColorState.mode=key==='hue'?'color':'white';lightColorRender();});
    lc('#lc-'+key).addEventListener('change',() => lightColorCommit(key==='bright'));
}
lightColorDialog.querySelectorAll('[data-lc-mode]').forEach(button => button.onclick=() => {lightColorState.mode=button.dataset.lcMode;lightColorRender();lightColorCommit();});
const lcWheel = lc('.lc-wheel'); let lcDrag = null;
function lightColorMove(event) {
    if(!lcDrag)return;
    const b=lcWheel.getBoundingClientRect();
    const angle=(Math.atan2(event.clientX-b.left-b.width/2,-(event.clientY-b.top-b.height/2))*180/Math.PI+360)%360;
    if(lcDrag==='hue'){lightColorState.hue=Math.round(angle)%360;lightColorState.mode='color';}
    else {lightColorState.temp=Math.round(lightColorState.minK+Math.min(angle,270)/270*(lightColorState.maxK-lightColorState.minK));lightColorState.mode='white';}
    lightColorRender();
}
lcWheel.addEventListener('pointerdown',event => {const b=lcWheel.getBoundingClientRect();const r=Math.hypot(event.clientX-b.left-b.width/2,event.clientY-b.top-b.height/2)/b.width;if(r<.19||r>.52||(r<.36&&!lightColorState.temperature)||(r>=.36&&!lightColorState.color))return;lcDrag=r>.36?'hue':'temp';lcWheel.setPointerCapture(event.pointerId);lightColorMove(event);});
lcWheel.addEventListener('pointermove',lightColorMove);
lcWheel.addEventListener('pointerup',() => {if(lcDrag)lightColorCommit();lcDrag=null;});
lcWheel.addEventListener('pointercancel',() => {lcDrag=null;});
