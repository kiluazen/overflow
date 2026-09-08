import { afterEach, expect, test, vi } from 'vitest';
import { Pool } from '../src/index.js';
import { compareJobs } from '../src/board-model.js';
import { MemoryState, remote } from './helpers.mjs';
const base='https://overflow.internal';
const order={objective:'Review the attached brief',context:'Private notes',expectedArtifact:'A review',acceptanceTest:'Addresses the brief'};
const activity=async pool=>(await pool.fetch(new Request(base+'/api/activity'))).json();
afterEach(()=>vi.restoreAllMocks());

test('existing accounts receive the additional grant once while preserving earned, spent and reserved credits',async()=>{
  const state=new MemoryState();
  await state.storage.put('account:old',{userId:'old',displayName:'Existing member',balance:1050,reserved:100,earned:250,spent:100,refunded:100});
  const pool=new Pool(state,{});await state.ready;
  const migrated=await state.storage.get('account:old');
  expect(migrated).toMatchObject({balance:10050,reserved:100,earned:250,spent:100,refunded:100,startingGrant:10000});
  const member=(await activity(pool)).members[0];expect(member.id).toMatch(/^[a-f0-9-]{36}$/);expect(member.lastActiveAt).toBe(0);
  const restarted=new Pool(state,{});await state.ready;
  await remote(restarted,'/rpc/account-init','old','Existing member',{});
  expect(await state.storage.get('account:old')).toMatchObject({...migrated});
  await remote(restarted,'/rpc/account-init','new','New member',{});
  expect((await state.storage.get('account:new')).balance).toBe(10000);
});

test('requester presence does not refresh when another person returns or refunds their task',async()=>{
  const clock=vi.spyOn(Date,'now');const start=1800000000000;clock.mockReturnValue(start);
  const state=new MemoryState();const pool=new Pool(state,{});await state.ready;
  await remote(pool,'/rpc/submit','requester','Requester',{orders:[order]});
  expect((await activity(pool)).members.find(m=>m.name==='Requester')).toMatchObject({lastActiveAt:start,activeSource:'codex'});
  clock.mockReturnValue(start+121000);
  const claim=await (await remote(pool,'/rpc/claim','worker','Worker',{})).json();
  await remote(pool,'/rpc/return','worker','Worker',{jobId:claim.id,status:'failed',artifact:'Input unavailable'});
  const board=await activity(pool);
  expect(board.members.find(m=>m.name==='Requester')).toMatchObject({lastActiveAt:start,activeSource:null,balance:10000});
  expect(board.members.find(m=>m.name==='Worker').activeSource).toBe('codex');
});

test('browser activity expires and closing one page does not close another page',async()=>{
  const clock=vi.spyOn(Date,'now');const start=1800000000000;clock.mockReturnValue(start);
  const state=new MemoryState();const pool=new Pool(state,{});await state.ready;
  await remote(pool,'/rpc/account-init','person','Member',{});
  clock.mockReturnValue(start+200000);
  const a='a'.repeat(64)+':'+crypto.randomUUID(),b='b'.repeat(64)+':'+crypto.randomUUID();
  const beat=(sessionId,visible)=>remote(pool,'/rpc/browser-presence','person','Member',{sessionId,visible});
  await beat(a,true);await beat(b,true);
  expect((await activity(pool)).members[0].activeSource).toBe('browser');
  await beat(a,false);expect((await activity(pool)).members[0].activeSource).toBe('browser');
  clock.mockReturnValue(start+291000);
  expect((await activity(pool)).members[0]).toMatchObject({lastActiveAt:start+200000,activeSource:null});
  await beat(b,true);await beat(b,false);
  expect((await activity(pool)).members[0].activeSource).toBeNull();
});

test('all unfinished jobs precede terminal jobs, with recent work first and stable ties',()=>{
  const jobs=[
    {id:'done-old',status:'completed',createdAt:2,completedAt:3},
    {id:'done-new',status:'completed',createdAt:1,completedAt:100},
    {id:'working',status:'claimed',createdAt:4},
    {id:'waiting',status:'queued',createdAt:8},
    {id:'failed',status:'failed',createdAt:5,completedAt:90},
    {id:'a-waiting',status:'queued',createdAt:8},
  ];
  expect(jobs.sort(compareJobs).map(j=>j.id)).toEqual(['a-waiting','waiting','working','done-new','failed','done-old']);
});
