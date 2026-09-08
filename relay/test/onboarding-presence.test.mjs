import { afterEach, expect, test, vi } from 'vitest';
import { defaultHandler, Pool } from '../src/index.js';
import { createDashboardHandoff, createPresenceCookie, tokenHash } from '../src/browser-presence.js';
import { MemoryState, MemoryBucket, remote } from './helpers.mjs';

const BASE='https://overflow.kushalsm.com';
function req(path,options={}){return new Request(BASE+path,options)}
async function setup(){
  const values=new Map();
  const state=new MemoryState();
  const env={
    OAUTH_KV:{get:async key=>values.get(key)||null,put:async(key,value)=>values.set(key,value),delete:async key=>values.delete(key)},
    GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',ARTIFACTS:new MemoryBucket(),
    OAUTH_PROVIDER:{completeAuthorization:vi.fn(async()=>({redirectTo:'https://codex.test/callback?code=test'}))},
  };
  const pool=new Pool(state,env);await state.ready;
  env.POOL={idFromName:name=>name,get:()=>({fetch:async(url,options)=>pool.fetch(new Request(url,options))})};
  return {env,pool,state,values};
}
function googleToken(overrides={}){return 'header.'+btoa(JSON.stringify({sub:'alice',email:'alice@example.com',name:'Alice',email_verified:true,aud:'test-client',iss:'https://accounts.google.com',exp:Math.floor(Date.now()/1000)+3600,picture:'https://lh3.googleusercontent.com/avatar',...overrides}))+'.sig'}
function cookies(response){return response.headers.getSetCookie().filter(value=>!value.includes('Max-Age=0')).map(value=>value.split(';')[0]).join('; ')}
async function googleStart(env,clientName='Codex'){
  await env.OAUTH_KV.put('consent:nonce',JSON.stringify({_client:clientName,clientId:'codex',scope:['overflow:connect'],redirectUri:'https://codex.test/callback',state:'host-state',codeChallenge:'original-pkce',codeChallengeMethod:'S256'}));
  const start=await defaultHandler.fetch(req('/auth/google/start?nonce=nonce'),env);
  const location=new URL(start.headers.get('location'));
  return {state:location.searchParams.get('state'),cookie:cookies(start),location};
}
async function googleFinish(env,overrides={},clientName='Codex'){
  const start=await googleStart(env,clientName);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id_token:googleToken(overrides)})));
  const response=await defaultHandler.fetch(req('/auth/google/callback?code=google-code&state='+start.state,{headers:{cookie:start.cookie}}),env);
  const html=await response.clone().text();
  return {response,html,id:html.match(/name="setup" value="([a-f0-9-]+)"/)?.[1],cookie:cookies(response),start};
}
function complete(env,id,cookie,origin=BASE){return defaultHandler.fetch(req('/auth/complete',{method:'POST',headers:{cookie,origin},body:new URLSearchParams({setup:id})}),env)}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});

test('Google login ends with the supplied hook guide before completing the original OAuth handoff',async()=>{
  const {env,pool}=await setup();
  const {response,html,id,cookie,start}=await googleFinish(env);
  expect(start.location.searchParams.get('scope')).toBe('openid email profile');
  expect(response.status).toBe(200);expect(html).toContain('Google connected');
  expect(response.headers.get('referrer-policy')).toBe('origin');
  expect(response.headers.get('content-security-policy')).toContain("form-action 'self' https://codex.test;");
  expect(html).toContain('/setup-hooks-v1.png');expect(html).toContain('less than 10%');
  expect(env.OAUTH_PROVIDER.completeAuthorization).not.toHaveBeenCalled();
  const returned=await complete(env,id,cookie);
  expect(returned.status).toBe(303);expect(returned.headers.get('location')).toBe('https://codex.test/callback?code=test');
  expect(returned.headers.get('set-cookie')).toContain('__Host-overflow-presence=');
  expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({
    userId:'google-alice',request:expect.objectContaining({state:'host-state',codeChallenge:'original-pkce'}),
    props:expect.objectContaining({picture:'https://lh3.googleusercontent.com/avatar'}),
  }));
  const board=await (await pool.fetch(req('/api/activity'))).json();
  expect(board.members[0]).toMatchObject({name:'Alice',balance:10000,picture:'https://lh3.googleusercontent.com/avatar',lastActiveAt:0});
  expect(JSON.stringify(board)).not.toContain('alice@example.com');expect(JSON.stringify(board)).not.toContain('google-alice');
  expect((await complete(env,id,cookie)).status).toBe(400);
  expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledTimes(1);
});

test('OAuth continuation is browser-bound, same-origin, expiring and single-use even for concurrent submits',async()=>{
  const {env,values}=await setup();const {id,cookie}=await googleFinish(env);
  expect((await complete(env,id,'')).status).toBe(400);
  expect((await complete(env,id,cookie,'https://other.test')).status).toBe(400);
  const responses=await Promise.all([complete(env,id,cookie),complete(env,id,cookie)]);
  expect(responses.map(r=>r.status).sort()).toEqual([303,400]);
  expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledTimes(1);
  const second=await googleFinish(env);
  const pending=JSON.parse(values.get('setup:'+second.id));pending.expiresAt=Date.now()-1;values.set('setup:'+second.id,JSON.stringify(pending));
  expect((await complete(env,second.id,second.cookie)).status).toBe(400);
});

test('Claude OAuth returns to the same authorization with manual commands and no Codex hook setup',async()=>{
  const {env}=await setup();const {html,id,cookie}=await googleFinish(env,{},'Claude Code');
  expect(html).toContain('Return to Claude');expect(html).toContain('/overflow:work');expect(html).toContain('/overflow:earn');
  expect(html).not.toContain('Codex');expect(html).not.toContain('/setup-hooks-v1.png');expect(html).not.toContain('usage hook');
  expect((await complete(env,id,cookie)).status).toBe(303);
  expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({request:expect.objectContaining({state:'host-state',codeChallenge:'original-pkce'})}));
});

test('Google callbacks cannot be copied into a different browser or accept invalid identity claims',async()=>{
  const {env}=await setup();const start=await googleStart(env);
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  const response=await defaultHandler.fetch(req('/auth/google/callback?code=code&state='+start.state),env);
  expect(response.status).toBe(400);expect(fetchMock).not.toHaveBeenCalled();
  for(const overrides of [{aud:'wrong'},{iss:'https://fake.example'},{exp:1},{email_verified:false}]){
    const result=await googleFinish(env,overrides);expect(result.response.status).toBe(400);expect(result.id).toBeUndefined();
  }
  expect(env.OAUTH_PROVIDER.completeAuthorization).not.toHaveBeenCalled();
});

test('missing or unsafe profile pictures fall back without preventing Google connection',async()=>{
  const {env,pool}=await setup();const {id,cookie}=await googleFinish(env,{picture:'https://untrusted.example/picture'});
  expect((await complete(env,id,cookie)).status).toBe(303);
  const board=await (await pool.fetch(req('/api/activity'))).json();expect(board.members[0].picture).toBe('');
});

test('dashboard has no account login routes and remains readable without a cookie',async()=>{
  const {env}=await setup();
  const board=await defaultHandler.fetch(req('/'),env);
  expect(board.status).toBe(200);
  const html=await board.text();expect(html).not.toMatch(/<form|<select|<summary|<a\s/i);
  expect(html).toContain('id="task-dialog"');expect(html).toContain('href="/favicon.svg"');
  expect(html).not.toContain('Sign in');expect(html).not.toContain('100 credits');
  expect((await defaultHandler.fetch(req('/auth/dashboard/start'),env)).headers.get('location')).toBe(BASE+'/');
  expect((await defaultHandler.fetch(req('/api/account'),env)).status).toBe(404);
  expect((await defaultHandler.fetch(req('/api/activity'),env)).status).toBe(200);
});

test('a private one-time plugin handoff establishes only browser presence without another login',async()=>{
  const {env,pool,values}=await setup();await remote(pool,'/rpc/account-init','google-alice','Alice',{});
  const url=await createDashboardHandoff(env,'google-alice');
  const accepted=await defaultHandler.fetch(new Request(url),env);
  expect(accepted.status).toBe(303);expect(accepted.headers.get('location')).toBe('/');
  const cookie=cookies(accepted);expect(cookie).toContain('__Host-overflow-presence=');
  const pageId=crypto.randomUUID();
  const beat=()=>defaultHandler.fetch(req('/api/presence',{method:'POST',headers:{cookie,origin:BASE,'content-type':'application/json'},body:JSON.stringify({pageId,visible:true,userId:'google-bob'})}),env);
  expect((await beat()).status).toBe(204);
  const replay=await defaultHandler.fetch(new Request(url),env);expect(replay.headers.get('set-cookie')).toBeNull();
  const sessions=[...values.keys()].filter(key=>key.startsWith('presence-session:'));
  expect(sessions).toHaveLength(1);expect(JSON.parse(values.get(sessions[0])).userId).toBe('google-alice');
  const board=await (await pool.fetch(req('/api/activity'))).json();expect(board.members).toHaveLength(1);
  const forged=await defaultHandler.fetch(req('/api/presence',{method:'POST',headers:{cookie:'__Host-overflow-presence=forged',origin:BASE},body:JSON.stringify({pageId,visible:true})}),env);
  expect(forged.status).toBe(401);
  const crossOrigin=await defaultHandler.fetch(req('/api/presence',{method:'POST',headers:{cookie,origin:'https://other.test'},body:JSON.stringify({pageId,visible:true})}),env);
  expect(crossOrigin.status).toBe(403);
  for(const key of sessions){const value=JSON.parse(values.get(key));value.expiresAt=1;values.set(key,JSON.stringify(value))}
  expect((await beat()).status).toBe(401);
});

test('expired or replayed handoffs cannot set another browser cookie',async()=>{
  const {env,values}=await setup();const url=await createDashboardHandoff(env,'google-alice');
  const key='presence-handoff:'+await tokenHash(new URL(url).pathname.split('/').pop());
  const value=JSON.parse(values.get(key));value.expiresAt=1;values.set(key,JSON.stringify(value));
  expect((await defaultHandler.fetch(new Request(url),env)).headers.get('set-cookie')).toBeNull();
});
