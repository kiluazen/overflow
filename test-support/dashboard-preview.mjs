// Local QA fixtures only. This server and its sample people never deploy.
import http from 'node:http';
import { BOARD_HTML } from '../relay/src/board.js';
import { SHORELINE_JPEG_BASE64 } from '../relay/src/shoreline.js';
const started=Date.now();
const members=['Alex','Sam','Maya','Dev','Meera','Ishan','Rohan'].map((name,index)=>({id:'preview-'+index,name,picture:'',balance:10000+(index%3-1)*100,lastActiveAt:started-index*120000,activeSource:index<2?'codex':null,activeUntil:index<2?started+120000:0}));
const jobs=[
 {id:'preview-waiting',status:'queued',objective:'Compare three places to stay in Kyoto',requester:'Alex',requesterMemberId:'preview-0',createdAt:started-8*60000},
 {id:'preview-working',status:'claimed',objective:'Turn the research brief into a five-slide presentation',requester:'Sam',requesterMemberId:'preview-1',worker:'Maya',workerMemberId:'preview-2',createdAt:started-20*60000,claimedAt:started-10*60000},
 {id:'preview-done',status:'completed',objective:'Review the onboarding copy',requester:'Meera',requesterMemberId:'preview-4',worker:'Dev',workerMemberId:'preview-3',createdAt:started-70*60000,completedAt:started-40*60000},
 {id:'preview-failed',status:'failed',objective:'Inspect the supplied project files',requester:'Ishan',requesterMemberId:'preview-5',worker:'Rohan',workerMemberId:'preview-6',createdAt:started-90*60000,completedAt:started-60*60000},
];
let scenario='normal';
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:8794');
 if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(BOARD_HTML.replace('<title>Overflow</title>','<title>Overflow · local QA fixtures</title>'));return}
 if(url.pathname==='/shoreline-v2.jpg'){res.writeHead(200,{'content-type':'image/jpeg'});res.end(Buffer.from(SHORELINE_JPEG_BASE64,'base64'));return}
 if(url.pathname==='/api/activity'){
  if(scenario==='failure'){res.writeHead(503);res.end('preview unavailable');return}
  const people=scenario==='empty'?[]:members.map((m,i)=>scenario==='long'&&i===0?{...m,name:'A very long member name with several words',picture:'https://lh3.googleusercontent.com/overflow-invalid-avatar'}:m);
  const work=scenario==='empty'?[]:jobs.map((j,i)=>scenario==='long'&&i===0?{...j,objective:'A long task title '+('with a lot of context and extensive detail '.repeat(10))}:j);
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({now:Date.now(),members:people,jobs:work}));return
 }
 if(url.pathname==='/api/presence'){res.writeHead(401);res.end();return}
 if(url.pathname==='/__preview/scenario'&&req.method==='POST'){scenario=url.searchParams.get('mode')||'normal';res.writeHead(204);res.end();return}
 res.writeHead(404);res.end('Not found');
});
server.listen(8794,'127.0.0.1',()=>console.log('Local-only dashboard fixtures: http://127.0.0.1:8794'));
