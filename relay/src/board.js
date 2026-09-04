// Dense public operations board. It renders one authoritative snapshot from
// the Durable Object instead of reconstructing state from overlapping feeds.
export const BOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overflow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
  :root{color-scheme:dark;--ground:#090c0a;--panel:#0e1310;--panel2:#121914;
    --ink:#dff8e5;--muted:#78927e;--hair:#203126;--green:#71efa0;
    --yellow:#eacb70;--red:#ff8b77;--blue:#8eafff;--mono:"Geist Mono",monospace;
    --sans:"Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  *{box-sizing:border-box}html,body{min-height:100%}body{margin:0;background:var(--ground);
    color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.35}
  main{width:min(1500px,100%);margin:0 auto;padding:24px}
  header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;
    padding-bottom:18px;border-bottom:1px solid var(--hair)}
  h1{font-size:24px;line-height:1;margin:0 0 8px;font-weight:600;letter-spacing:-.03em}
  .lede{color:var(--muted);font-family:var(--mono);font-size:12px}
  .live{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;color:var(--muted)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 12px #71efa077}
  #error{display:none;margin-top:12px;padding:9px 12px;border:1px solid #6e3329;
    color:var(--red);background:#1d100d;font-family:var(--mono);font-size:11px}
  .metrics{display:grid;grid-template-columns:repeat(7,minmax(110px,1fr));gap:1px;
    background:var(--hair);border:1px solid var(--hair);margin:18px 0}
  .metric{background:var(--panel);padding:13px 14px;min-height:76px}
  .metric b{display:block;font-family:var(--mono);font-size:23px;font-weight:500;
    letter-spacing:-.04em;margin-bottom:7px}.metric span{color:var(--muted);font-size:11px}
  .grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(320px,.7fr);gap:18px}
  .stack{display:grid;gap:18px;align-content:start}.section{border:1px solid var(--hair);background:var(--panel)}
  .section-head{display:flex;justify-content:space-between;gap:18px;align-items:center;
    padding:11px 13px;border-bottom:1px solid var(--hair)}
  h2{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.09em;font-weight:600}
  .hint{font-family:var(--mono);color:var(--muted);font-size:10px}
  .scroll{overflow:auto;max-height:570px}table{width:100%;border-collapse:collapse;min-width:720px}
  th{position:sticky;top:0;z-index:1;background:var(--panel2);color:var(--muted);
    text-align:left;font:500 10px var(--mono);text-transform:uppercase;letter-spacing:.08em;
    padding:8px 11px;border-bottom:1px solid var(--hair)}
  td{padding:10px 11px;border-bottom:1px solid var(--hair);vertical-align:top}
  tr:last-child td{border-bottom:0}.mono{font-family:var(--mono);font-size:11px}
  .muted{color:var(--muted)}.money{color:var(--yellow);font-family:var(--mono);white-space:nowrap}
  .objective{max-width:580px}.objective b{display:-webkit-box;font-weight:500;margin-bottom:3px;
    -webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .objective small{display:block;color:var(--muted);font-size:11px;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;max-width:520px}.route{white-space:nowrap;font-size:12px}
  .state{display:inline-flex;align-items:center;gap:7px;font:500 10px var(--mono);
    text-transform:uppercase;letter-spacing:.05em}.state:before{content:"";width:7px;height:7px;
    border-radius:50%;background:var(--muted)}.state.claimed:before{background:var(--blue)}
  .state.completed:before{background:var(--green)}.state.failed:before{background:var(--red)}
  details summary{cursor:pointer;color:var(--blue);font:11px var(--mono);list-style:none}
  details summary::-webkit-details-marker{display:none}pre{white-space:pre-wrap;font:11px/1.55 var(--mono);
    color:var(--ink);border-left:2px solid var(--hair);padding-left:10px;max-height:220px;overflow:auto}
  .files{color:var(--muted);font:10px/1.5 var(--mono);margin-top:5px}
  .accounts{min-width:620px}.accounts td:first-child{font-weight:500}.positive{color:var(--green)}
  .events{list-style:none;padding:0;margin:0;max-height:360px;overflow:auto}
  .events li{display:grid;grid-template-columns:54px 66px 1fr;gap:8px;padding:9px 12px;
    border-bottom:1px solid var(--hair);font-size:11px}.events li:last-child{border:0}
  .events time,.events code{font:10px var(--mono);color:var(--muted)}.events li span{min-width:0;overflow-wrap:anywhere}
  .empty{padding:26px 14px;color:var(--muted);font:11px var(--mono);text-align:center}
  .rule{padding:13px;color:var(--muted);font-size:12px}.rule b{color:var(--ink);font-family:var(--mono)}
  @media(max-width:980px){.metrics{grid-template-columns:repeat(4,1fr)}.grid{grid-template-columns:1fr}}
  @media(max-width:620px){main{padding:16px}.metrics{grid-template-columns:repeat(2,1fr)}header{align-items:flex-start;
    flex-direction:column}.metric{min-height:68px}.events li{grid-template-columns:48px 58px 1fr}}
</style>
</head>
<body><main>
  <header><div><h1>Overflow</h1><div class="lede" id="creditRule">Loading the pool…</div></div>
    <div class="live"><span class="dot"></span><span id="refreshed">connecting</span></div></header>
  <div id="error"></div>
  <section class="metrics">
    <div class="metric"><b id="available">—</b><span>available credits</span></div>
    <div class="metric"><b id="reserved">—</b><span>reserved in work</span></div>
    <div class="metric"><b id="transferred">—</b><span>earned by workers</span></div>
    <div class="metric"><b id="members">—</b><span>members</span></div>
    <div class="metric"><b id="queued">—</b><span>queued</span></div>
    <div class="metric"><b id="running">—</b><span>running</span></div>
    <div class="metric"><b id="finished">—</b><span>completed</span></div>
  </section>
  <div class="grid">
    <section class="section"><div class="section-head"><h2>All work</h2><span class="hint" id="jobCount"></span></div>
      <div class="scroll"><table><thead><tr><th>State</th><th>Task</th><th>Route</th><th>Credits</th><th>Timing</th><th>Result</th></tr></thead>
      <tbody id="jobs"></tbody></table></div></section>
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Members</h2><span class="hint">OAuth accounts</span></div>
        <div class="scroll"><table class="accounts"><thead><tr><th>Member</th><th>Available</th><th>Held</th><th>Earned</th><th>Spent</th><th>Refunded</th><th>Work</th></tr></thead>
        <tbody id="accounts"></tbody></table></div></section>
      <section class="section"><div class="section-head"><h2>Activity</h2><span class="hint" id="workerState"></span></div><ol class="events" id="events"></ol></section>
      <section class="section"><div class="rule" id="rule"></div></section>
    </div>
  </div>
</main>
<script>
var esc=function(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;")};
var n=function(v){return Number(v||0).toLocaleString("en-US")};
var ago=function(ms,now){if(!ms)return "—";var s=Math.max(0,Math.floor((now-ms)/1000));if(s<60)return s+"s ago";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago"};
var until=function(ms,now){if(!ms)return "";var s=Math.max(0,Math.floor((ms-now)/1000));if(s<60)return s+"s lease";if(s<3600)return Math.floor(s/60)+"m lease";return Math.floor(s/3600)+"h "+Math.floor((s%3600)/60)+"m lease"};
var duration=function(a,b,now){if(!a)return "—";var end=b||now;var s=Math.max(0,Math.floor((end-a)/1000));if(s<60)return s+"s";if(s<3600)return Math.floor(s/60)+"m";return Math.floor(s/3600)+"h "+Math.floor((s%3600)/60)+"m"};
var set=function(id,value){document.getElementById(id).textContent=value};
var resultCell=function(j){if(!j.artifactChars&&!j.files.length)return '<span class="muted">—</span>';var files=j.files.length?'<div class="files">'+j.files.map(esc).join(" · ")+'</div>':"";return '<span class="mono">'+n(j.artifactChars)+' chars · '+n(j.files.length)+' files</span>'+files};
var creditCell=function(j){if(!j.credits)return '<span class="muted">legacy</span>';if(j.status==="completed")return '<span class="money">+'+n(j.credits)+' worker</span>';if(j.status==="failed")return '<span class="money">'+n(j.credits)+' refunded</span>';return '<span class="money">−'+n(j.credits)+' held</span>'};
var render=function(d){
  var c=d.credits||{},t=d.totals||{},now=d.now||Date.now();
  set("available",n(c.available));set("reserved",n(c.reserved));set("transferred",n(c.transferred));set("members",n(t.accounts));
  set("queued",n(t.queued));set("running",n(t.claimed));set("finished",n(t.completed));
  set("creditRule",n(c.starting)+" credits on signup · "+n(c.perOrder)+" credits per completed order");
  set("refreshed","live · "+new Date(now).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}));
  set("jobCount",n(t.jobs)+" total · "+n(t.failed)+" failed");
  set("workerState",n(d.online)+" legacy sessions · "+n(d.idle)+" idle");
  document.getElementById("rule").innerHTML='<b>'+n(c.perOrder)+' credits</b> move only when work completes. Queued and running work is reserved; failed work is refunded.';
  var jobs=d.jobs||[];
  document.getElementById("jobs").innerHTML=jobs.length?jobs.map(function(j){
    var lease=j.status==="claimed"?'<div class="muted mono">'+until(j.leaseExpiresAt,now)+' · try '+n(j.attempts)+'/2</div>':(j.attempts?'<div class="muted mono">'+n(j.attempts)+' claim'+(j.attempts===1?'':'s')+'</div>':'');
    var timing=ago(j.createdAt,now)+'<div class="muted mono">'+duration(j.claimedAt||j.createdAt,j.completedAt,now)+'</div>'+lease;
    var route=esc(j.requester)+'<div class="muted">→ '+esc(j.worker||"unclaimed")+'</div>';
    return '<tr><td><span class="state '+esc(j.status)+'">'+esc(j.status)+'</span><div class="muted mono">'+esc(j.id.slice(0,8))+'</div></td>'+
      '<td class="objective"><b title="'+esc(j.objective||"Untitled order")+'">'+esc(j.objective||"Untitled order")+'</b><small>'+esc(j.expectedArtifact||"No artifact specified")+'</small></td>'+
      '<td class="route">'+route+'</td><td>'+creditCell(j)+'</td><td class="mono">'+timing+'</td><td>'+resultCell(j)+'</td></tr>';
  }).join(""):'<tr><td colspan="6" class="empty">No OAuth work has been submitted yet.</td></tr>';
  var accounts=d.accounts||[];
  document.getElementById("accounts").innerHTML=accounts.length?accounts.map(function(a){return '<tr><td>'+esc(a.name)+'<div class="muted mono">'+ago(a.lastSeenAt,now)+'</div></td><td class="money">'+n(a.balance)+'</td><td class="money">'+n(a.reserved)+'</td><td class="positive mono">+'+n(a.earned)+'</td><td class="mono">'+n(a.spent)+'</td><td class="mono">'+n(a.refunded)+'</td><td class="mono">'+n(a.completed)+' done · '+n(a.delegated)+' sent</td></tr>'}).join(""):'<tr><td colspan="7" class="empty">Members appear after Google sign-in.</td></tr>';
  var events=(d.events||[]).slice(0,40);
  document.getElementById("events").innerHTML=events.length?events.map(function(e){var credits=e.credits?' · '+n(e.credits)+' '+esc(e.creditState||"credits"):"";var text;if(e.type==="joined")text=esc(e.member||"member")+' joined';else{text=esc(e.objective||"order")+(e.worker?' · '+esc(e.requester||"someone")+' → '+esc(e.worker):' · '+esc(e.requester||"someone"))}return '<li><time>'+ago(e.at,now)+'</time><code>'+esc(e.type)+'</code><span>'+text+credits+'</span></li>'}).join(""):'<li class="empty">No activity yet.</li>';
  document.getElementById("error").style.display="none";
};
var tick=function(){fetch("/api/activity",{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}).then(render).catch(function(err){var box=document.getElementById("error");box.textContent="Dashboard refresh failed: "+err.message;box.style.display="block";set("refreshed","disconnected")})};
tick();setInterval(tick,3000);
</script></body></html>`;
