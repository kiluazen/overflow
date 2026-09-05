// Local browser QA only. Sample data and sign-in never reach the deployed Worker.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {BOARD_HTML} from '../relay/src/board.js';
import {dashboardAccount, finishDashboardLogin, logoutDashboard} from '../relay/src/dashboard-auth.js';
const now=Date.now();
const jobs=[
  {id:'preview-research',status:'queued',objective:'Compare three places to stay in Kyoto',expectedArtifact:'A short comparison with prices, walking distances, and sources',requester:'Preview requester',createdAt:now-8*60000,files:[],credits:100},
  {id:'preview-review',status:'queued',objective:'Review the onboarding copy for a small reading app',expectedArtifact:'Suggested edits and a short explanation for each change',requester:'Preview requester',createdAt:now-12*60000,files:[],credits:100},
  {id:'preview-running',status:'claimed',objective:'Turn a research brief into a five-slide presentation',expectedArtifact:'An editable slide deck with source links',requester:'Preview requester',worker:'Preview earner',createdAt:now-20*60000,claimedAt:now-15*60000,leaseExpiresAt:now+75*60000,attempts:1,files:[],credits:100},
  {id:'preview-done',status:'completed',objective:'Check a landing page for confusing language',expectedArtifact:'A Markdown review of the page',requester:'Preview requester',worker:'Preview earner',createdAt:now-70*60000,completedAt:now-40*60000,files:['copy-review.md'],credits:100},
  {id:'preview-failed',status:'failed',objective:'Inspect a file that was not included in the order',expectedArtifact:'A file review',requester:'Preview requester',worker:'Preview earner',createdAt:now-90*60000,completedAt:now-60*60000,files:[],credits:100},
];
const kv=new Map();
const env={OAUTH_KV:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v),delete:async k=>kv.delete(k)},POOL:{idFromName:n=>n,get:()=>({fetch:async()=>Response.json({account:{name:'Preview earner',balance:1100,reserved:100,earned:200,spent:0},credits:{starting:1000,perOrder:100}})})}};
let fail=false;
const server=http.createServer(async(req,res)=>{
  try{
    const request=new Request('http://localhost:8792'+req.url,{method:req.method,headers:req.headers});
    let response;
    if(req.url==='/')response=new Response(BOARD_HTML.replace('<body>','<body><aside style="position:relative;z-index:10;text-align:center;padding:8px;background:#e8ede5;font-size:11px">Local preview · sample tasks · <a href="/__preview/sign-in">Test signed-in view</a> · <a href="/__preview/fail">Simulate refresh failure</a> · <a href="/__preview/recover">Recover</a></aside>'),{headers:{'content-type':'text/html'}});
    else if(req.url==='/shoreline-v2.jpg')response=new Response(await readFile(new URL('../design/shoreline-v2.jpg',import.meta.url)),{headers:{'content-type':'image/jpeg'}});
    else if(req.url==='/api/activity')response=fail?new Response('Preview error',{status:503}):Response.json({now:Date.now(),totals:{queued:2,claimed:1,completed:1,failed:1,jobs:5},jobs});
    else if(req.url==='/api/account')response=await dashboardAccount(request,env);
    else if(req.url==='/auth/dashboard/logout')response=await logoutDashboard(request,env);
    else if(req.url==='/__preview/sign-in')response=await finishDashboardLogin(env,{userId:'google-preview-earner',displayName:'Preview earner',email:'preview@example.com'});
    else if(req.url==='/__preview/fail'||req.url==='/__preview/recover'){fail=req.url==='/__preview/fail';response=new Response(null,{status:302,headers:{location:'/'}})}
    else if(req.url==='/auth/dashboard/start')response=new Response('Google sign-in is tested in the Worker; this local UI preview uses the labelled sample sign-in above.',{headers:{'content-type':'text/plain'}});
    else response=new Response('Not found',{status:404});
    const headers=Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie'));
    const cookies=response.headers.getSetCookie();
    if(cookies.length)headers['set-cookie']=cookies;
    res.writeHead(response.status,headers);
    const body=Buffer.from(await response.arrayBuffer());
    res.end(body);
  }catch(error){res.writeHead(500);res.end(String(error))}
});
server.listen(8792,'127.0.0.1',()=>console.log('Local UI preview with sample data: http://localhost:8792'));
