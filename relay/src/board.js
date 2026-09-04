// The public board. Everything on it is something the relay already handles:
// an order queued, an order claimed by a machine, an artifact returned. There
// are no derived metrics and no scores -- the point is watching work move.
export const BOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overflow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
  :root{
    --ground:#F2EEE4; --raised:#F8F5EF; --ink:#14161B; --muted:#6C7080;
    --hair:#DDD6C8; --blue:#1d2bb8; --spent:#B4402C; --live:#1f7a4d;
    --sans:"Geist",ui-sans-serif,-apple-system,"Segoe UI",sans-serif;
    --mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;
  }
  @media (prefers-color-scheme:dark){:root{
    --ground:#101016; --raised:#17171F; --ink:#EDE9DF; --muted:#918FA0;
    --hair:#2A2A36; --blue:#8E97FF; --spent:#E4785F; --live:#5FD39B;
  }}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);
    font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
  main{max-width:1060px;margin:0 auto;padding:0 24px 80px}
  header{padding:44px 0 8px;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
  .wordmark{font-size:19px;font-weight:600;letter-spacing:-.02em}
  .eyebrow{font-family:var(--mono);font-size:11.5px;text-transform:uppercase;
    letter-spacing:.14em;color:var(--muted)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--live);display:inline-block;
    margin-right:7px;vertical-align:1px}
  .dot.off{background:var(--muted)}
  h1{font-size:clamp(26px,4vw,38px);line-height:1.1;letter-spacing:-.03em;font-weight:600;
    margin:18px 0 0;max-width:22ch;text-wrap:balance}
  .sub{color:var(--muted);margin:10px 0 0;max-width:62ch}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0;margin-top:34px}
  .tile{border:1px solid var(--hair);padding:18px 20px 20px;margin-left:-1px;margin-top:-1px}
  .tile .k{font-family:var(--mono);font-size:11.5px;text-transform:uppercase;
    letter-spacing:.12em;color:var(--muted)}
  .tile .v{font-family:var(--mono);font-size:30px;letter-spacing:-.02em;margin-top:8px;
    font-variant-numeric:tabular-nums}
  .tile .n{font-size:13px;color:var(--muted);margin-top:4px}
  h2{font-size:12.5px;font-family:var(--mono);font-weight:500;text-transform:uppercase;
    letter-spacing:.13em;color:var(--muted);margin:52px 0 16px;padding-bottom:9px;
    border-bottom:1px solid var(--hair)}
  .machines{display:flex;flex-wrap:wrap;gap:8px}
  .chip{font-family:var(--mono);font-size:12.5px;border:1px solid var(--hair);
    padding:6px 11px;background:var(--raised)}
  .chip.busy{border-color:var(--blue);color:var(--blue)}
  .empty{color:var(--muted);font-size:15px;padding:14px 0}
  .row{border-top:1px solid var(--hair);padding:13px 2px;display:grid;
    grid-template-columns:64px 92px 1fr;gap:16px;align-items:baseline}
  .row:last-child{border-bottom:1px solid var(--hair)}
  .t{font-family:var(--mono);font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
  .tag{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em}
  .tag.queued{color:var(--muted)}
  .tag.claimed{color:var(--blue)}
  .tag.returned{color:var(--live)}
  .tag.failed{color:var(--spent)}
  .obj{font-size:15px}
  .who{color:var(--muted);font-size:13.5px;margin-top:2px}
  details{margin-top:8px}
  summary{cursor:pointer;font-family:var(--mono);font-size:12px;color:var(--blue)}
  pre{font-family:var(--mono);font-size:12.5px;line-height:1.65;background:var(--raised);
    border:1px solid var(--hair);padding:14px 16px;overflow-x:auto;white-space:pre-wrap;
    margin:9px 0 0;max-height:340px}
  footer{margin-top:60px;padding-top:20px;border-top:1px solid var(--hair);
    color:var(--muted);font-size:13px;display:flex;justify-content:space-between;
    gap:14px;flex-wrap:wrap}
  a{color:var(--blue)}
</style>
</head>
<body>
<main>
  <header>
    <span class="wordmark">Overflow</span>
    <span class="eyebrow" id="pulse"><span class="dot off"></span>connecting</span>
  </header>
  <h1>Work moving between friends' Codex installations.</h1>
  <p class="sub">Every order that gets queued, picked up and returned, as the relay sees it.
     Nothing here is a score.</p>

  <div class="tiles">
    <div class="tile"><div class="k">Machines online</div><div class="v" id="m-online">–</div>
      <div class="n" id="m-idle">&nbsp;</div></div>
    <div class="tile"><div class="k">Waiting to be taken</div><div class="v" id="m-queued">–</div>
      <div class="n" id="m-waitnote">&nbsp;</div></div>
    <div class="tile"><div class="k">Being worked on now</div><div class="v" id="m-inflight">–</div>
      <div class="n" id="m-flightnote">&nbsp;</div></div>
    <div class="tile"><div class="k">Artifacts returned</div><div class="v" id="m-returned">–</div>
      <div class="n">in the last 60 events</div></div>
  </div>

  <h2>Who is here</h2>
  <div class="machines" id="machines"></div>

  <h2>Waiting to be taken</h2>
  <div id="waiting"></div>

  <h2>Activity</h2>
  <div id="events"></div>

  <footer>
    <span>overflow.kushalsm.com</span>
    <span id="stamp">–</span>
  </footer>
</main>
<script>
var esc = function (s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};
var ago = function (ms) {
  var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
};
var render = function (d) {
  var online = d.online || 0;
  document.getElementById("m-online").textContent = (d.machines || []).length;
  document.getElementById("m-idle").textContent =
    online + " session" + (online === 1 ? "" : "s") + ", " + (d.idle || 0) + " free";
  document.getElementById("m-queued").textContent = d.queued || 0;
  document.getElementById("m-waitnote").textContent =
    (d.queued ? "open /earn to take one" : "nothing waiting");
  var flight = (d.inFlight || []).length;
  document.getElementById("m-inflight").textContent = flight;
  document.getElementById("m-flightnote").textContent =
    flight ? "in a visible /earn task" : " ";
  var events = d.events || [];
  document.getElementById("m-returned").textContent =
    events.filter(function (e) { return e.type === "returned"; }).length;

  var pulse = document.getElementById("pulse");
  pulse.innerHTML = '<span class="dot' + (online ? '' : ' off') + '"></span>' +
    (online ? "live" : "nobody online");

  var machines = d.machines || [];
  document.getElementById("machines").innerHTML = machines.length
    ? machines.map(function (m) {
        return '<span class="chip' + (m.busy ? " busy" : "") + '">' + esc(m.name) +
          (m.sessions > 1 ? " ×" + m.sessions : "") +
          (m.busy ? " · working" : "") + "</span>";
      }).join("")
    : '<div class="empty">Nobody has Codex open with the plugin installed right now.</div>';

  var waiting = d.waiting || [];
  document.getElementById("waiting").innerHTML = waiting.length
    ? waiting.map(function (w) {
        return '<div class="row"><span class="t">–</span>' +
          '<span class="tag queued">queued</span><div><div class="obj">' +
          esc(w.objective || "(no objective)") + "</div>" +
          (w.attempts ? '<div class="who">retry ' + w.attempts + "</div>" : "") +
          "</div></div>";
      }).join("")
    : '<div class="empty">No orders waiting.</div>';

  document.getElementById("events").innerHTML = events.length
    ? events.map(function (e) {
        var who = e.type === "queued"
          ? "from " + esc(e.from || "someone")
          : "on " + esc(e.worker || "a machine");
        var extra = "";
        if (e.type === "returned" || e.type === "failed") {
          var bits = [];
          if (e.artifactChars) bits.push(e.artifactChars.toLocaleString() + " chars");
          if (e.files && e.files.length) bits.push(e.files.length + " file(s)");
          if (e.delivered === false) bits.push("requester had gone");
          if (bits.length) who += " · " + bits.join(" · ");
          if (e.artifact) {
            extra = "<details><summary>artifact</summary><pre>" +
              esc(e.artifact) + "</pre></details>";
          }
        }
        return '<div class="row"><span class="t">' + ago(e.at) + "</span>" +
          '<span class="tag ' + esc(e.type) + '">' + esc(e.type) + "</span>" +
          '<div><div class="obj">' + esc(e.objective || "(no objective)") + "</div>" +
          '<div class="who">' + who + "</div>" + extra + "</div></div>";
      }).join("")
    : '<div class="empty">Nothing has run yet.</div>';

  document.getElementById("stamp").textContent = "updated " + new Date().toLocaleTimeString();
};
var tick = function () {
  fetch("/api/activity", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(render)
    .catch(function () {
      document.getElementById("pulse").innerHTML =
        '<span class="dot off"></span>relay unreachable';
    });
};
tick();
setInterval(tick, 3000);
</script>
</body>
</html>`;
