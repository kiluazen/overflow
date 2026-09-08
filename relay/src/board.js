import { compareJobs } from "./board-model.js";

// A read-only social surface. Every action stays in the plugin.
export const BOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f5f5ef">
<meta name="description" content="A little help from your friends.">
<title>Overflow</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light;--paper:#f5f5ef;--ink:#29342f;--muted:#697269;--sea:#376451;--line:#d9dfd5}
*{box-sizing:border-box}body{margin:0;min-height:100svh;color:var(--ink);background:var(--paper);font:14px/1.5 Geist,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.shell{width:min(1030px,calc(100% - 64px));margin:auto;padding-bottom:180px}
header{height:88px;display:flex;align-items:center;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;font-size:23px;font-weight:500;letter-spacing:-1px}.brand svg{width:25px;height:25px;fill:none;stroke:var(--sea);stroke-width:1.7;stroke-linecap:round}
h1{font:inherit;margin:0}h2{font-size:12px;font-weight:500;color:var(--muted);margin:0 0 23px}
.people{padding:32px 0 35px}.members{display:grid;grid-template-columns:repeat(auto-fill,minmax(124px,1fr));gap:28px 16px;list-style:none;padding:0;margin:0}
.member{min-width:0}.face{position:relative;display:block;width:46px;height:46px;margin-bottom:12px}.avatar{position:relative;width:100%;height:100%;display:grid;place-items:center;border-radius:50%;background:#e1e7dd;color:var(--sea);font-size:15px;font-weight:500;overflow:hidden}.avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.dot{position:absolute;right:-1px;bottom:1px;width:10px;height:10px;border-radius:50%;border:2px solid var(--paper);background:#558e61}.dot[hidden]{display:none}
.member-name{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}.balance{font-size:24px;font-weight:500;letter-spacing:-.7px;font-variant-numeric:tabular-nums}.last-active{font-size:10px;color:var(--muted);min-height:15px;margin-top:3px;white-space:nowrap}
.work{background:rgba(249,250,245,.93);border:1px solid rgba(201,211,199,.8);border-radius:10px;overflow:hidden}.work h2{padding:20px 23px 14px;margin:0;color:var(--ink);font-size:13px}.jobs{list-style:none;padding:0;margin:0}
.job{display:grid;grid-template-columns:minmax(0,1fr) minmax(140px,205px) 148px;gap:22px;align-items:center;padding:18px 23px;border-top:1px solid var(--line);cursor:pointer}.job:hover{background:#f2f5ed}.job:focus-visible{outline:2px solid var(--sea);outline-offset:-3px}
.objective{margin:0;font-size:13px;font-weight:400;line-height:1.5;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.route{display:flex;align-items:center;gap:8px;min-width:0;font-size:11px;color:var(--muted)}.route-person{display:flex;align-items:center;gap:6px;min-width:0}.route-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.route .avatar{width:22px;height:22px;flex-shrink:0;font-size:8px}.arrow{color:#889084;flex-shrink:0}.unclaimed{color:#889084}
.job-state{text-align:right;font-size:11px}.status{display:flex;justify-content:flex-end;align-items:center;gap:6px}.state-mark{width:5px;height:5px;border-radius:50%;background:#a1aa96}.claimed .state-mark{background:var(--sea)}.completed .state-mark{width:auto;height:auto;background:none;color:var(--sea)}.failed .state-mark{background:#a98360}.when{display:block;color:var(--muted);font-size:10px;margin-top:4px}.empty{font-size:12px;color:var(--muted);padding:0 23px 23px;margin:0}.people>.empty{padding:0}.error{font-size:11px;color:#855b35;margin:14px 0}.error[hidden]{display:none}
.dialog{width:min(920px,calc(100% - 32px));height:min(760px,calc(100svh - 32px));padding:0;border:1px solid var(--line);border-radius:14px;background:#fafbf6;color:var(--ink);box-shadow:0 24px 80px rgba(41,52,47,.18)}.dialog::backdrop{background:rgba(41,52,47,.28);backdrop-filter:blur(3px)}.dialog-shell{height:100%;display:flex;flex-direction:column}.dialog-head{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid var(--line)}.dialog-kicker{font-size:11px;color:var(--muted);margin:0}.dialog-close{border:0;background:transparent;color:var(--ink);font:inherit;font-size:24px;line-height:1;cursor:pointer;padding:4px 8px}.dialog-body{overflow:auto;padding:clamp(28px,6vw,70px);max-width:800px}.dialog-title{font-size:clamp(24px,4vw,42px);line-height:1.15;letter-spacing:-1.2px;font-weight:500;margin:0 0 46px}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px 42px}.detail dt{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}.detail dd{margin:0;font-size:14px}.detail-wide{grid-column:1/-1}.dialog[open]{animation:open-dialog .18s ease-out}@keyframes open-dialog{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:none}}
@media(max-width:700px){.shell{width:calc(100% - 36px);padding-bottom:140px}header{height:72px}.people{padding:26px 0 30px}.members{grid-template-columns:repeat(3,minmax(0,1fr));gap:24px 12px}.balance{font-size:22px}.face{width:40px;height:40px;margin-bottom:9px}.last-active{font-size:10px}.work h2{padding:17px 16px 12px}.job{grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:16px}.objective{grid-column:1/-1}.route{font-size:10px;gap:6px}.route .avatar{width:19px;height:19px}.job-state{font-size:10px}.when{font-size:9px}.empty{padding:0 16px 19px}}
@media(max-width:360px){.members{grid-template-columns:repeat(2,minmax(0,1fr))}.route .avatar{display:none}}
@media(max-width:520px){.dialog{width:100%;height:100svh;max-height:none;border:0;border-radius:0}.dialog-body{padding:28px 20px}.detail-grid{grid-template-columns:1fr}.detail-wide{grid-column:auto}}
</style>
</head>
<body>
<div class="shell">
<header><div class="brand"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M3 10c4-5 7 5 11 0s7 5 11 0M3 17c4-5 7 5 11 0s7 5 11 0"/></svg><h1>overflow</h1></div></header>
<main>
<section class="people" aria-labelledby="credits-title"><h2 id="credits-title">Credits</h2><ul class="members" id="members" aria-busy="true"></ul><p class="empty" id="people-empty" hidden>No one here yet.</p></section>
<section class="work" aria-labelledby="work-title"><h2 id="work-title">Tasks</h2><ul class="jobs" id="jobs" aria-busy="true"></ul><p class="empty" id="jobs-empty" hidden>No tasks yet.</p></section>
<p class="error" id="error" role="status" hidden></p>
</main>
</div>
<dialog class="dialog" id="task-dialog" aria-labelledby="dialog-title"><div class="dialog-shell"><div class="dialog-head"><p class="dialog-kicker">Task details</p><button class="dialog-close" id="dialog-close" type="button" aria-label="Close task details">×</button></div><div class="dialog-body" id="dialog-body"></div></div></dialog>
<script>
${compareJobs.toString()}
const $=id=>document.getElementById(id);
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node};
const num=value=>Number(value||0).toLocaleString('en-US');
let snapshot=null,busy=false,lastSignature='',clockOffset=0,presenceAllowed=true;
const pageId=crypto.randomUUID();
const now=()=>Date.now()+clockOffset;
function ago(at){const seconds=Math.max(0,Math.floor((now()-at)/1000));return seconds<60?'just now':seconds<3600?Math.floor(seconds/60)+'m ago':seconds<86400?Math.floor(seconds/3600)+'h ago':seconds<604800?Math.floor(seconds/86400)+'d ago':new Date(at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
function avatar(person){const face=el('span','avatar');face.setAttribute('aria-hidden','true');face.textContent=(person.name||'?').trim().split(/\s+/).slice(0,2).map(n=>Array.from(n)[0]||'').join('').toUpperCase();if(person.picture){try{const u=new URL(person.picture);if(u.protocol==='https:'&&u.hostname.endsWith('.googleusercontent.com')){const img=document.createElement('img');img.src=u.href;img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.onerror=()=>img.remove();face.append(img)}}catch{}}return face}
function active(person){return Boolean(person.activeSource&&person.activeUntil>now())}
function updateTimes(){for(const person of snapshot?.members||[]){const item=document.getElementById('member-'+person.id);if(!item)continue;const isActive=active(person);item.querySelector('.dot').hidden=!isActive;const last=item.querySelector('.last-active');last.textContent=isActive&&person.activeSource==='browser'?'On Overflow':person.lastActiveAt?'Last active '+ago(person.lastActiveAt):'';item.title=isActive&&person.activeSource==='browser'?'Viewing Overflow':person.lastActiveAt?'Active in Overflow '+ago(person.lastActiveAt):person.name}for(const node of document.querySelectorAll('.when'))node.textContent=ago(Number(node.dataset.at))}
function renderMembers(members){const list=$('members');const people=[...members].sort((a,b)=>Number(active(b))-Number(active(a))||String(a.name).localeCompare(String(b.name))||String(a.id).localeCompare(String(b.id)));list.replaceChildren(...people.map(person=>{const item=el('li','member');item.id='member-'+person.id;const face=el('span','face');face.append(avatar(person),el('span','dot'));item.append(face,el('div','member-name',person.name),el('div','balance',num(person.balance)),el('div','last-active'));return item}));$('people-empty').hidden=people.length>0;list.setAttribute('aria-busy','false')}
function routePerson(person){const node=el('span','route-person');node.append(avatar(person),el('span','route-name',person.name));node.title=person.name;return node}
const labels={queued:'Waiting for a computer',claimed:'Working',completed:'Done',failed:'Unfinished'};
function showJob(job){const body=$('dialog-body');body.replaceChildren();body.append(el('h2','dialog-title',job.objective||'Untitled task'));const grid=el('dl','detail-grid');const detail=(label,value,wide=false)=>{const wrap=el('div','detail'+(wide?' detail-wide':''));wrap.append(el('dt','',label),el('dd','',value));grid.append(wrap)};detail('Status',labels[job.status]||job.status);detail('Credits',num(job.credits));detail('From',job.requester||'Someone');detail('To',job.worker||'Waiting for a computer');if(job.expectedArtifact)detail('Expected artifact',job.expectedArtifact,true);detail('Created',new Date(job.createdAt).toLocaleString());if(job.completedAt)detail('Finished',new Date(job.completedAt).toLocaleString());if(job.attempts)detail('Attempts',String(job.attempts));if(job.files?.length)detail('Files',job.files.join(', '),true);if(job.artifactChars)detail('Result','Artifact returned · '+num(job.artifactChars)+' characters',true);body.append(grid);$('task-dialog').showModal()}
function renderJobs(jobs,members){const people=new Map(members.map(person=>[person.id,person]));$('jobs').replaceChildren(...[...jobs].sort(compareJobs).map(job=>{const item=el('li','job '+job.status);item.tabIndex=0;item.setAttribute('role','button');item.setAttribute('aria-label','Open task: '+(job.objective||'Untitled task'));item.addEventListener('click',()=>showJob(job));item.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showJob(job)}});const objective=el('p','objective',job.objective||'Untitled task');objective.title=job.objective||'';const route=el('div','route');route.append(routePerson(people.get(job.requesterMemberId)||{name:job.requester||'Someone'}),el('span','arrow','→'));route.append(job.worker?routePerson(people.get(job.workerMemberId)||{name:job.worker}):el('span','unclaimed','—'));const state=el('div','job-state');const label=el('span','status');const mark=el('span','state-mark',job.status==='completed'?'✓':'');mark.setAttribute('aria-hidden','true');label.append(mark,el('span','',labels[job.status]||job.status));const when=el('time','when');when.dataset.at=job.completedAt||job.claimedAt||job.createdAt;when.dateTime=new Date(Number(when.dataset.at)).toISOString();state.append(label,when);item.append(objective,route,state);return item}));$('jobs-empty').hidden=jobs.length>0;$('jobs').setAttribute('aria-busy','false')}
async function refresh(){if(busy)return;busy=true;try{const r=await fetch('/api/activity',{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();clockOffset=Number(data.now||Date.now())-Date.now();snapshot=data;const members=data.members||[],jobs=data.jobs||[];const signature=JSON.stringify([members,jobs]);if(signature!==lastSignature){renderMembers(members);renderJobs(jobs,members);lastSignature=signature}updateTimes();$('error').hidden=true}catch{$('error').textContent=snapshot?'Couldn’t refresh. Showing the last update.':'Couldn’t load Overflow.';$('error').hidden=false;$('members').setAttribute('aria-busy','false');$('jobs').setAttribute('aria-busy','false');updateTimes()}finally{busy=false}}
async function heartbeat(visible=!document.hidden){if(!presenceAllowed)return;try{const r=await fetch('/api/presence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageId,visible}),keepalive:true});if(r.status===401)presenceAllowed=false}catch{}}
refresh();if(!document.hidden)heartbeat();
setInterval(()=>{if(!document.hidden)refresh()},10000);
setInterval(()=>{if(!document.hidden)heartbeat()},30000);
setInterval(updateTimes,5000);
document.addEventListener('visibilitychange',()=>{heartbeat(!document.hidden);if(!document.hidden){presenceAllowed=true;refresh()}});
window.addEventListener('pagehide',()=>heartbeat(false));
window.addEventListener('pageshow',event=>{if(event.persisted){presenceAllowed=true;refresh();heartbeat()}});
$('dialog-close').addEventListener('click',()=>$('task-dialog').close());
$('task-dialog').addEventListener('click',event=>{if(event.target===$('task-dialog'))$('task-dialog').close()});
</script>
</body></html>`;
