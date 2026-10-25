const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync('script.js','utf8');
const values=new Map();
const ctx={URLSearchParams,Uint8Array,TextEncoder,Date,crypto,btoa,console,window:{crypto,location:{href:'',search:''},history:{replaceState(){}}},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},document:{getElementById:()=>({textContent:''})},spotifySaveTokens:data=>ctx.saved=data};
vm.createContext(ctx);
vm.runInContext('const SPOTIFY_REDIRECT_URI="https://steve1676.github.io/dashboard-domotique/DashBoard/";const SPOTIFY_CLIENT_ID="test";const SPOTIFY_SCOPES="user-read-playback-state";'+source.slice(source.indexOf('function spotifyRandomString('),source.indexOf('function spotifySaveTokens(')),ctx);
const run=s=>vm.runInContext(s,ctx);
(async()=>{
 ctx.window.dashboardAndroidSpotify=true;
 await run('spotifyLogin()');
 const auth=new URL(ctx.window.location.href);
 assert.equal(auth.searchParams.get('redirect_uri'),'com.steve.dashboard.spotify://callback');
 const state=auth.searchParams.get('state');
 ctx.window.location.search='?code=test-code&state='+state;
 let requests=0;
 ctx.fetch=async(url,options)=>{requests++;assert.equal(options.body.get('redirect_uri'),'com.steve.dashboard.spotify://callback');assert.ok(options.body.get('code_verifier'));return {ok:true,json:async()=>({access_token:'test-token'})}};
 await run('spotifyHandleRedirect()');assert.equal(requests,1);assert.equal(ctx.saved.access_token,'test-token');
 await run('spotifyHandleRedirect()');assert.equal(requests,1); // retour rejoué rejeté
 values.set('spotify_code_verifier_old',JSON.stringify({verifier:'x',ts:Date.now()-700000}));
 assert.throws(()=>run('spotifyConsumeVerifier("old")'),/expirée/);
 assert.throws(()=>run('spotifyConsumeVerifier("")'),/état/);
 ctx.window.dashboardAndroidSpotify=false;await run('spotifyLogin()');
 assert.equal(new URL(ctx.window.location.href).searchParams.get('redirect_uri'),'https://steve1676.github.io/dashboard-domotique/DashBoard/');
 console.log('Spotify : PKCE Android/navigateur, retour, expiration et protection contre le rejeu validés.');
})().catch(error=>{console.error(error);process.exitCode=1});
