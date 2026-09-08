import { afterEach, expect, test, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { Pool } from '../src/index.js';
import { MemoryState, MemoryBucket, remote } from './helpers.mjs';
const BASE='https://overflow.internal';
const order={objective:'Use the input to make a review',context:'Private working context',expectedArtifact:'A review file',acceptanceTest:'The review uses the provided input'};
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
async function setup(){const state=new MemoryState();const bucket=new MemoryBucket();const pool=new Pool(state,{ARTIFACTS:bucket});await state.ready;return {state,bucket,pool}}
async function prepare(pool,bytes,name='brief.md'){
  const response=await remote(pool,'/rpc/input-uploads','requester','Requester',{name,size:bytes.byteLength,sha256:await hash(bytes),contentType:'application/octet-stream'});
  expect(response.status).toBe(200);return response.json();
}
const upload=(pool,ticket,bytes)=>pool.fetch(new Request(ticket.uploadUrl,{method:'PUT',headers:{'content-length':String(bytes.byteLength)},body:bytes}));
const getInputs=(pool,jobId,actor='requester')=>remote(pool,'/rpc/inputs?jobId='+jobId,actor,actor);
const credits=async(pool,actor='requester')=>(await (await remote(pool,'/rpc/account',actor,actor)).json()).account;
afterEach(()=>vi.restoreAllMocks());

test('requester files travel through a claim, refresh and reassignment, and the output returns privately',async()=>{
  const {pool,state}=await setup();const bytes=new TextEncoder().encode('A real input file with decisions to review.');
  const ticket=await prepare(pool,bytes);
  const submittedOrder={...order,inputArtifactIds:[ticket.artifactId]};
  expect((await remote(pool,'/rpc/submit','requester','Requester',{orders:[submittedOrder]})).status).toBe(409);
  expect(await credits(pool)).toMatchObject({balance:10000,reserved:0});
  expect((await upload(pool,ticket,bytes)).status).toBe(201);
  expect((await upload(pool,ticket,bytes)).status).toBe(404);
  expect((await remote(pool,'/rpc/submit','stranger','Stranger',{orders:[submittedOrder]})).status).toBe(403);
  const submitted=await (await remote(pool,'/rpc/submit','requester','Requester',{orders:[submittedOrder]})).json();
  expect(submitted.balance).toBe(9900);
  const claim=await (await remote(pool,'/rpc/claim','worker','Worker',{})).json();
  expect(claim.inputs).toHaveLength(1);expect(claim.inputs[0]).toMatchObject({name:'brief.md',size:bytes.byteLength,sha256:await hash(bytes)});
  expect(new Uint8Array(await (await pool.fetch(new Request(claim.inputs[0].url))).arrayBuffer())).toEqual(bytes);
  expect((await getInputs(pool,claim.id,'stranger')).status).toBe(403);
  const key='input-download:'+new URL(claim.inputs[0].url).pathname.split('/').pop();
  await state.storage.put(key,{...await state.storage.get(key),expiresAt:Date.now()-1});
  expect((await pool.fetch(new Request(claim.inputs[0].url))).status).toBe(410);
  const refreshed=await (await getInputs(pool,claim.id,'worker')).json();
  expect((await pool.fetch(new Request(refreshed.files[0].url))).status).toBe(200);
  const stored=await state.storage.get('remote-job:'+claim.id);stored.leaseExpiresAt=Date.now()-1;await state.storage.put('remote-job:'+claim.id,stored);
  await pool.alarm();
  expect((await pool.fetch(new Request(refreshed.files[0].url))).status).toBe(403);
  const second=await (await remote(pool,'/rpc/claim','worker-2','Second worker',{})).json();
  expect(second.id).toBe(claim.id);expect(second.attempts).toBe(2);
  expect(new Uint8Array(await (await pool.fetch(new Request(second.inputs[0].url))).arrayBuffer())).toEqual(bytes);
  expect((await getInputs(pool,claim.id,'worker')).status).toBe(403);
  const output=new TextEncoder().encode('# Review\nThe input contains decisions to review.');
  const outputTicket=await (await remote(pool,'/rpc/uploads','worker-2','Second worker',{jobId:claim.id,name:'review.md',contentType:'text/markdown'})).json();
  expect((await pool.fetch(new Request(outputTicket.uploadUrl,{method:'PUT',headers:{'content-length':String(output.byteLength)},body:output}))).status).toBe(201);
  expect((await remote(pool,'/rpc/return','worker-2','Second worker',{jobId:claim.id,artifact:'Review complete.',files:[{artifactId:outputTicket.artifactId}]})).status).toBe(200);
  expect((await pool.fetch(new Request(second.inputs[0].url))).status).toBe(403);
  const inbox=await (await remote(pool,'/rpc/inbox','requester','Requester')).json();
  const result=inbox.batches[0].jobs[0].result;
  expect(new Uint8Array(await (await pool.fetch(new Request(result.files[0].url))).arrayBuffer())).toEqual(output);
  expect((await getInputs(pool,claim.id)).status).toBe(200);
  expect(await credits(pool)).toMatchObject({balance:9900,reserved:0,spent:100});
  expect(await credits(pool,'worker-2')).toMatchObject({balance:10100,earned:100});
  const activity=await (await pool.fetch(new Request(BASE+'/api/activity'))).json();
  const serialized=JSON.stringify(activity);
  for(const privateValue of [ticket.artifactId,'/api/input-files/','inputs/','Private working context','ownerUserId',await hash(bytes)])expect(serialized).not.toContain(privateValue);
  expect(activity.jobs[0].inputCount).toBe(1);
});

test('checksum and byte limits are checked before an input becomes usable',async()=>{
  const {pool}=await setup();const bytes=new Uint8Array([1,2,3]);const ticket=await prepare(pool,bytes,'../../asset.bin');
  expect(ticket.name).toBe('.._.._asset.bin');
  expect((await upload(pool,ticket,new Uint8Array([3,2,1]))).status).toBe(422);
  expect((await upload(pool,ticket,new Uint8Array([1,2,3,4]))).status).toBe(413);
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3,4]));controller.close()}});
  expect((await pool.fetch(new Request(ticket.uploadUrl,{method:'PUT',body:stream}))).status).toBe(422);
  expect((await upload(pool,ticket,bytes)).status).toBe(201);
  expect((await remote(pool,'/rpc/input-uploads','requester','Requester',{name:'too-large.bin',size:50*1024*1024+1,sha256:await hash(bytes)})).status).toBe(413);
});

test('concurrent use of an upload capability commits only one input',async()=>{
  const {pool,bucket}=await setup();const bytes=new Uint8Array([1,2,3]);const ticket=await prepare(pool,bytes);
  const responses=await Promise.all([upload(pool,ticket,bytes),upload(pool,ticket,bytes)]);
  expect(responses.filter(r=>r.status===201)).toHaveLength(1);expect(bucket.objects.size).toBe(1);
});

test('the real Workers R2 binding stores streams and rejects mismatched checksums',async()=>{
  const state=new MemoryState();const pool=new Pool(state,{ARTIFACTS:env.ARTIFACTS});await state.ready;
  const bytes=crypto.getRandomValues(new Uint8Array(32000));const ticket=await prepare(pool,bytes);
  const file=await state.storage.get('input:'+ticket.artifactId);
  try {
    expect((await upload(pool,ticket,new Uint8Array(bytes.length))).status).toBe(422);
    expect(await env.ARTIFACTS.get(file.objectKey)).toBeNull();
    expect((await upload(pool,ticket,bytes)).status).toBe(201);
    expect(new Uint8Array(await (await env.ARTIFACTS.get(file.objectKey)).arrayBuffer())).toEqual(bytes);
  } finally { await env.ARTIFACTS.delete(file.objectKey); }
});

test('attachment count and aggregate size failures never reserve credits or queue work',async()=>{
  const {pool,state}=await setup();await remote(pool,'/rpc/account-init','requester','Requester',{});
  const ids=[];
  for(let i=0;i<11;i++){
    const id=crypto.randomUUID();ids.push(id);
    await state.storage.put('input:'+id,{artifactId:id,ownerUserId:'requester',name:'file'+i,size:50*1024*1024,sha256:'a'.repeat(64),uploadedAt:Date.now(),createdAt:Date.now()});
  }
  expect((await remote(pool,'/rpc/submit','requester','Requester',{orders:[{...order,inputArtifactIds:ids}]})).status).toBe(400);
  expect((await remote(pool,'/rpc/submit','requester','Requester',{orders:[{...order,inputArtifactIds:ids.slice(0,5)}]})).status).toBe(413);
  expect((await remote(pool,'/rpc/submit','requester','Requester',{orders:[{...order,inputArtifactIds:[ids[0],ids[0]]}]})).status).toBe(400);
  expect(await credits(pool)).toMatchObject({balance:10000,reserved:0});expect(pool.queue).toHaveLength(0);
});

test('alarms clean abandoned inputs, retain queued inputs, and delete terminal inputs after 30 days',async()=>{
  const {pool,state,bucket}=await setup();const clock=vi.spyOn(Date,'now');const start=1800000000000;clock.mockReturnValue(start);
  const bytes=new Uint8Array([1,2,3]);const abandoned=await prepare(pool,bytes);await upload(pool,abandoned,bytes);
  const attached=await prepare(pool,bytes);await upload(pool,attached,bytes);
  const submitted=await (await remote(pool,'/rpc/submit','requester','Requester',{orders:[{...order,inputArtifactIds:[attached.artifactId]}]})).json();
  clock.mockReturnValue(start+25*60*60*1000);await pool.alarm();
  expect(await state.storage.get('input:'+abandoned.artifactId)).toBeUndefined();
  expect(await state.storage.get('input:'+attached.artifactId)).toBeDefined();expect(bucket.objects.size).toBe(1);
  const claim=await (await remote(pool,'/rpc/claim','worker','Worker',{})).json();
  await remote(pool,'/rpc/return','worker','Worker',{jobId:claim.id,artifact:'Done'});
  const completedAt=Date.now();clock.mockReturnValue(completedAt+30*24*60*60*1000+1);await pool.alarm();
  expect(bucket.objects.size).toBe(0);expect(await state.storage.get('input:'+attached.artifactId)).toBeUndefined();
  expect((await getInputs(pool,submitted.jobs[0])).status).toBe(410);
  const inbox=await (await remote(pool,'/rpc/inbox','requester','Requester')).json();expect(inbox.batches[0].jobs[0].result.artifact).toBe('Done');
});
