const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const nodes=new Map();
function node(){return {value:'',textContent:'',innerHTML:'',open:false,setAttribute(k,v){this[k]=v},getAttribute(k){return this[k]},addEventListener(){},querySelectorAll(){return []},showModal(){this.open=true},close(){this.open=false},focus(){}}}
const saved={};
const context={URL,URLSearchParams,AbortController,Date,console,setInterval(){},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,body:{append(){}},head:{append(){}}},storageGet:(k,f)=>saved[k]??f,storageSet:(k,v)=>saved[k]=v,window:{},fetch:async()=>{throw Error('Unexpected network')}};
vm.createContext(context);
const main=fs.readFileSync('script.js','utf8');
vm.runInContext(main.slice(main.indexOf('function googleCalendarUrl('),main.indexOf('// ─── Spotify',main.indexOf('function googleCalendarUrl('))),context);
vm.runInContext(fs.readFileSync('calendar.js','utf8'),context);
function run(s){return vm.runInContext(s,context)}
(async()=>{
 assert.match(nodes.get('calendar-next').innerHTML,/Configurez/);
 run('calendarOpen();calendarSwitch()');assert.equal(saved.calendar_view,'three');assert.match(nodes.get('cal-content').innerHTML,/cal-three/);
 run('calendarSwitch()');assert.equal(saved.calendar_view,'month');assert.match(nodes.get('cal-content').innerHTML,/cal-month-layout/);
 run('calendarState.anchor=new Date(2026,11,31);calendarMove(1)');assert.equal(run('calendarState.anchor.getFullYear()'),2027);assert.equal(run('calendarState.anchor.getMonth()'),0);
 run("calendarState.events=[calEvent({summary:'<img onerror=alert(1)>',start:{date:'2026-10-24'},end:{date:'2026-10-26'}})]");
 assert.equal(run('calEventsFor(new Date(2026,9,25)).length'),1);assert.equal(run('calEventsFor(new Date(2026,9,26)).length'),0);
 assert.match(run('calEventMarkup(calendarState.events[0])'),/&lt;img/);
 saved.google_calendar='https://calendar.google.com/calendar/embed?src=test%40example.com';saved.calendar_api_key='test-key';
 let calls=0;
 context.fetch=async url=>{calls++;assert.equal(url.searchParams.get('singleEvents'),'true');return {ok:true,json:async()=>calls===1?{items:[],nextPageToken:'next'}:{items:[{summary:'Real event',start:{date:'2026-10-24'},end:{date:'2026-10-25'}}]}}};
 await run('calendarLoad()');assert.equal(calls,2);assert.equal(run('calendarState.events.length'),1);
 context.fetch=async()=>({ok:false,status:403});await run('calendarLoad()');assert.match(run('calendarState.message'),/inaccessible/);assert.equal(run('calendarState.events.length'),0);
 run('clearGoogleCalendar()');assert.equal(saved.google_calendar,'');assert.equal(run('calendarState.token'),'');
 console.log('Calendar: views, navigation, exclusive all-day end, escaping, pagination, API errors and removal passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
