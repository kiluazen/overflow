// The board. One image, one ledger, no numbers.
//
// Everything on it is an order the relay actually handled. State is a glyph
// rather than a count: a long queue looks long, work in progress turns, a
// finished order is filled in. If you have to read a number to know what is
// happening, the board has failed.
export const BOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overflow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500&family=Geist+Mono:wght@400&display=swap">
<style>
  :root{
    --ground:#EFE9DC; --ink:#191A1F; --muted:#7A7568; --hair:#D8CFBC;
    --blue:#1d2bb8; --live:#2C7A57; --spent:#A8442E; --wash:.13;
    --sans:"Geist",ui-sans-serif,-apple-system,"Segoe UI",sans-serif;
    --mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;
  }
  @media (prefers-color-scheme:dark){:root{
    --ground:#0C0D12; --ink:#E9E4D8; --muted:#7E7A8C; --hair:#242531;
    --blue:#93A0FF; --live:#63D3A0; --spent:#E08668; --wash:.20;
  }}
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);
    font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
  #sky{position:fixed;inset:0;z-index:0;pointer-events:none;
    background-image:url(/bg.jpg?v=2);background-size:cover;background-position:50% 38%;
    opacity:var(--wash);filter:saturate(.75)}
  #veil{position:fixed;inset:0;z-index:1;pointer-events:none;
    background:linear-gradient(180deg,var(--ground) 0%,transparent 26%,transparent 52%,var(--ground) 92%)}
  main{position:relative;z-index:2;max-width:760px;margin:0 auto;padding:64px 24px 96px}
  header{display:flex;align-items:center;justify-content:space-between;gap:18px;
    margin-bottom:56px}
  .mark{font-size:17px;font-weight:500;letter-spacing:.01em}
  .here{display:flex;gap:7px;align-items:center}
  .who{width:9px;height:9px;border-radius:50%;background:var(--muted);opacity:.45}
  .who.on{background:var(--blue);opacity:1}
  .who.working{background:var(--blue);animation:breathe 1.6s ease-in-out infinite}
  @keyframes breathe{0%,100%{opacity:1}50%{opacity:.3}}

  ol{list-style:none;margin:0;padding:0}
  li{display:grid;grid-template-columns:26px 1fr;gap:16px;align-items:start;
    padding:15px 0;border-bottom:1px solid var(--hair)}
  li:first-child{border-top:1px solid var(--hair)}
  .g{width:14px;height:14px;margin-top:4px;border-radius:50%;position:relative}
  .g.waiting{border:1.5px solid var(--muted);opacity:.55;
    animation:wait 2.6s ease-in-out infinite}
  @keyframes wait{0%,100%{opacity:.5}50%{opacity:.85}}
  .g.working{border:1.5px solid var(--hair);border-top-color:var(--blue);
    border-right-color:var(--blue);animation:spin .9s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .g.returned{background:var(--live)}
  .g.failed{border:1.5px solid var(--spent)}
  .g.failed:after{content:"";position:absolute;left:-2px;top:5px;width:18px;
    height:1.5px;background:var(--spent);transform:rotate(-45deg)}
  .txt{font-size:15.5px;letter-spacing:-.005em}
  .by{font-family:var(--mono);font-size:11.5px;color:var(--muted);margin-top:5px;
    letter-spacing:.02em}
  details summary{cursor:pointer;list-style:none;font-family:var(--mono);
    font-size:11.5px;color:var(--blue);margin-top:7px}
  details summary::-webkit-details-marker{display:none}
  pre{font-family:var(--mono);font-size:12.5px;line-height:1.7;white-space:pre-wrap;
    border-left:2px solid var(--hair);padding:2px 0 2px 15px;margin:11px 0 2px;
    max-height:330px;overflow-y:auto;color:var(--ink)}
  .quiet{color:var(--muted);font-size:15px;padding:44px 0;text-align:center;
    font-family:var(--mono);letter-spacing:.02em}
</style>
</head>
<body>
<div id="sky"></div><div id="veil"></div>
<main>
  <header>
    <span class="mark">Overflow</span>
    <span class="here" id="here"></span>
  </header>
  <ol id="ledger"></ol>
</main>
<script>
var esc = function (s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};
var seen = {};
var render = function (d) {
  var machines = d.machines || [];
  document.getElementById("here").innerHTML = machines.length
    ? machines.map(function (m) {
        return '<span class="who ' + (m.busy ? "working" : "on") + '" title="' +
          esc(m.name) + '"></span>';
      }).join("")
    : '<span class="who"></span>';

  var rows = [];
  (d.waiting || []).forEach(function (w) {
    rows.push({ state: "waiting", objective: w.objective, by: "" });
  });
  (d.events || []).forEach(function (e) {
    if (e.type === "queued") return;
    rows.push({
      state: e.type === "claimed" ? "working" : e.type,
      objective: e.objective,
      by: e.worker || "",
      artifact: e.artifact,
      files: e.files,
      jobId: e.jobId,
    });
  });

  // One line per order, showing where it got to. Events arrive newest first, so
  // the first time a job id appears is its latest state; the claim that preceded
  // its return, and any duplicate dispatch of the same order, collapse into it.
  var byJob = {}, keep = [];
  rows.forEach(function (r) {
    if (r.jobId) {
      if (byJob[r.jobId]) return;
      byJob[r.jobId] = 1;
    }
    keep.push(r);
  });

  document.getElementById("ledger").innerHTML = keep.length
    ? keep.map(function (r) {
        var extra = "";
        if (r.artifact) {
          extra = "<details><summary>read it</summary><pre>" +
            esc(r.artifact) + "</pre></details>";
        }
        var by = r.by ? '<div class="by">' + esc(r.by) + "</div>" : "";
        return "<li><span class=\"g " + r.state + "\"></span><div>" +
          '<div class="txt">' + esc(r.objective || "an order") + "</div>" +
          by + extra + "</div></li>";
      }).join("")
    : '<div class="quiet">still</div>';
};
var tick = function () {
  fetch("/api/activity", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(render)
    .catch(function () {});
};
tick();
setInterval(tick, 3000);
</script>
</body>
</html>`;
