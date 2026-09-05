import { afterEach, expect, test, vi } from "vitest";
import { defaultHandler } from "../src/index.js";
import { finishDashboardLogin } from "../src/dashboard-auth.js";

const BASE = 'https://overflow.kushalsm.com';
function setup() {
  const values = new Map();
  const accounts = new Map([
    ['google-alice', {name:'Alice',balance:900,earned:0,spent:100}],
    ['google-bob', {name:'Bob',balance:1100,earned:100,spent:0}],
  ]);
  const poolFetch = vi.fn(async (_url, options) => {
    const userId = options.headers['x-overflow-user-id'];
    return Response.json({account:accounts.get(userId),credits:{starting:1000,perOrder:100}});
  });
  const env = {
    OAUTH_KV:{get:async k=>values.get(k)||null,put:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k)},
    POOL:{idFromName:n=>n,get:()=>({fetch:poolFetch})},
    GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',
    OAUTH_PROVIDER:{completeAuthorization:vi.fn(async()=>({redirectTo:'https://codex.test/callback?code=test'}))},
  };
  return {env,values,poolFetch};
}
function req(path, options={}) { return new Request(BASE+path,options); }
function sessionCookie(response) {
  return response.headers.get('set-cookie').match(/__Host-overflow-session=([^;]+)/)[0];
}
async function signIn(env,userId,name) {
  const r=await finishDashboardLogin(env,{userId,displayName:name,email:name.toLowerCase()+'@example.com'});
  return {r,cookie:sessionCookie(r)};
}
function googleToken(sub='alice') {
  return 'header.'+btoa(JSON.stringify({sub,email:sub+'@example.com',name:sub,email_verified:true,
    aud:'test-client',iss:'https://accounts.google.com',exp:Math.floor(Date.now()/1000)+3600})) + '.signature';
}
afterEach(()=>vi.unstubAllGlobals());

test('anonymous and forged identities cannot retrieve dashboard credits',async()=>{
  const {env,poolFetch}=setup();
  for (const headers of [{},{'x-overflow-user-id':'google-bob'},{cookie:'__Host-overflow-session=forged'}]) {
    const r=await defaultHandler.fetch(req('/api/account?userId=google-bob',{headers}),env);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({signedIn:false});
    expect(r.headers.get('cache-control')).toBe('no-store');
  }
  expect(poolFetch).not.toHaveBeenCalled();
});

test('each dashboard session resolves only its own Google account and expires',async()=>{
  const {env,values}=setup();
  const a=await signIn(env,'google-alice','Alice');
  const b=await signIn(env,'google-bob','Bob');
  expect(a.r.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  for(const [c,name,balance] of [[a.cookie,'Alice',900],[b.cookie,'Bob',1100]]) {
    const r=await defaultHandler.fetch(req('/api/account?userId=google-bob',{headers:{cookie:c,'x-overflow-user-id':'google-bob'}}),env);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({signedIn:true,account:{name,balance}});
    expect(r.headers.get('vary')).toBe('Cookie');
  }
  expect([...values.keys()].every(k=>k.startsWith('dashboard:')&&!k.includes(a.cookie.split('=')[1]))).toBe(true);
  for(const [key,value] of values){const s=JSON.parse(value);s.expiresAt=0;values.set(key,JSON.stringify(s))}
  expect((await defaultHandler.fetch(req('/api/account',{headers:{cookie:a.cookie}}),env)).status).toBe(401);
});

test('logout requires same-origin POST and revokes the browser session',async()=>{
  const {env}=setup();const {cookie}=await signIn(env,'google-alice','Alice');
  expect((await defaultHandler.fetch(req('/auth/dashboard/logout',{headers:{cookie}}),env)).status).toBe(405);
  expect((await defaultHandler.fetch(req('/auth/dashboard/logout',{method:'POST',headers:{cookie,origin:'https://other.test'}}),env)).status).toBe(403);
  const r=await defaultHandler.fetch(req('/auth/dashboard/logout',{method:'POST',headers:{cookie,origin:BASE}}),env);
  expect(r.status).toBe(204);expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
  expect((await defaultHandler.fetch(req('/api/account',{headers:{cookie}}),env)).status).toBe(401);
});

test('dashboard Google callback is browser-bound and establishes the plugin account identity',async()=>{
  const {env}=setup();
  const login=await defaultHandler.fetch(req('/auth/dashboard/start'),env);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const start=await defaultHandler.fetch(req(login.headers.get('location')),env);
  const location=new URL(start.headers.get('location'));
  expect(location.origin).toBe('https://accounts.google.com');
  expect(location.searchParams.get('redirect_uri')).toBe(BASE+'/auth/google/callback');
  expect(location.searchParams.get('scope')).toBe('openid email profile');
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id_token:googleToken()})));
  const callback=await defaultHandler.fetch(req('/auth/google/callback?code=google-code&state='+location.searchParams.get('state'),{headers:{cookie}}),env);
  expect(callback.status).toBe(302);expect(callback.headers.get('location')).toBe('/');
  expect(env.OAUTH_PROVIDER.completeAuthorization).not.toHaveBeenCalled();
  const me=await defaultHandler.fetch(req('/api/account',{headers:{cookie:sessionCookie(callback)}}),env);
  expect(await me.json()).toMatchObject({signedIn:true,account:{name:'Alice',balance:900}});
  const replay=await defaultHandler.fetch(req('/auth/google/callback?code=google-code&state='+location.searchParams.get('state'),{headers:{cookie}}),env);
  expect(replay.status).toBe(400);
});

test('a dashboard callback copied into another browser cannot sign that browser in',async()=>{
  const {env}=setup();
  const login=await defaultHandler.fetch(req('/auth/dashboard/start'),env);
  const start=await defaultHandler.fetch(req(login.headers.get('location')),env);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  const callback=await defaultHandler.fetch(req('/auth/google/callback?code=google-code&state='+state),env);
  expect(callback.status).toBe(400);expect(callback.headers.get('set-cookie')).toBeNull();expect(fetchMock).not.toHaveBeenCalled();
});

test('plugin OAuth callback keeps its existing authorization flow',async()=>{
  const {env}=setup();
  await env.OAUTH_KV.put('google:state','nonce');
  await env.OAUTH_KV.put('consent:nonce',JSON.stringify({clientId:'codex',scope:['overflow:connect'],redirectUri:'https://codex.test/callback'}));
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id_token:googleToken()})));
  const r=await defaultHandler.fetch(req('/auth/google/callback?code=google-code&state=state'),env);
  expect(r.status).toBe(302);expect(r.headers.get('location')).toBe('https://codex.test/callback?code=test');
  expect(r.headers.get('set-cookie')).toBeNull();
  expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({userId:'google-alice'}));
});

test('a wrong Google audience cannot establish a dashboard session',async()=>{
  const {env}=setup();
  await env.OAUTH_KV.put('google:state','nonce');
  await env.OAUTH_KV.put('consent:nonce',JSON.stringify({_dashboard:true,_browserNonce:'browser'}));
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id_token:'header.'+btoa(JSON.stringify({sub:'alice',email:'a@example.com',email_verified:true,aud:'wrong',iss:'https://accounts.google.com',exp:9999999999}))+'.sig'})));
  const r=await defaultHandler.fetch(req('/auth/google/callback?code=code&state=state',{headers:{cookie:'__Host-overflow-login=browser'}}),env);
  expect(r.status).toBe(400);expect(r.headers.get('set-cookie')).toBeNull();
});
