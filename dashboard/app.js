// Backscatter's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, the model's proof, a filterable table and a per-protocol detail drawer with the
// netted farm plan. No network: every byte it shows arrived inside data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');

  var state = { q: '', category: 'all', verdict: 'all', watch: false, tab: 'pre', sort: 'rank', dir: 1, selected: null };

  // Deep links double as the page's own views: #verdict=farm, #watch=1, #tab=live, #detail=<slug>.
  var hash = {};
  (location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
    var p = kv.split('=');
    if (p.length === 2) hash[decodeURIComponent(p[0])] = decodeURIComponent(p[1]);
  });
  if (hash.verdict) state.verdict = hash.verdict;
  if (hash.watch === '1') state.watch = true;
  if (hash.tab === 'live') state.tab = 'live';
  if (hash.detail) state.selected = hash.detail;

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtSigned(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-' : '+') + fmtUsd(Math.abs(n)).slice(0);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var V = DATA.validation;
  var M = DATA.model;
  var PC = DATA.plan_constants;

  function headerHtml() {
    return (
      '<header class="masthead">' +
      '<h1>Back<span class="echo">scatter</span></h1>' +
      '<p class="tagline">Pre-token protocols, priced by the tokens that already trade — walk-forward tested, banded, and netted into $1,000 farm plans.</p>' +
      '<p class="dataline">Data: ' + esc(DATA.source) + ' &middot; snapshot date ' + esc(DATA.as_of) + ' &middot; model ' + esc(M.version) +
      ' &middot; every figure on this page was computed from that snapshot by the program that wrote it.</p>' +
      '</header>'
    );
  }

  function proofHtml() {
    var vc = DATA.verdict_counts;
    return (
      '<section class="proof">' +
      '<div class="stat"><div class="k">Walk-forward RMSLE</div><div class="v"><em>' + V.pooled_rmsle.toFixed(3) + '</em></div>' +
      '<div class="s">5 expanding folds over ' + V.comps + ' traded comps, each scored only on later listings. Naive multiple: ' + V.baseline_pooled_rmsle.toFixed(3) + '.</div></div>' +
      '<div class="stat"><div class="k">Repeated holdout</div><div class="v">' + V.holdout_mean_rmsle.toFixed(3) + '</div>' +
      '<div class="s">Mean of ' + V.holdout_seeds + ' random 80/20 splits (' + V.holdout_min_rmsle.toFixed(2) + ' to ' + V.holdout_max_rmsle.toFixed(2) + ') — the single-holdout yardstick, averaged so no lucky split speaks alone.</div></div>' +
      '<div class="stat"><div class="k">Board</div><div class="v">' + DATA.board_size + ' protocols</div>' +
      '<div class="s">All ' + DATA.watchlist_size + ' watchlist protocols plus ' + DATA.early_size + ' early ones below the $' + (DATA.floor_usd / 1e6) + 'M floor.</div></div>' +
      '<div class="stat"><div class="k">$1,000 verdicts</div><div class="v">' + vc.farm + ' / ' + vc.thin + ' / ' + vc.skip + '</div>' +
      '<div class="s">Farm / thin / skip after gas, hours at $' + PC.wage_usd_per_hour + '/h and 4% yield given up — judged at the band, not the point.' +
      (vc.farm === 0 ? ' On this snapshot no protocol\'s band low end clears its costs at $1,000, so the farm count is honestly zero; the thin tier is where the midpoint pays.' : '') + '</div></div>' +
      '</section>'
    );
  }

  function methodHtml() {
    var folds = V.folds.map(function (f) {
      return '<tr><td>fold ' + f.fold + '</td><td>' + f.train_size + '</td><td>' + f.test_size + '</td><td>' + esc(f.test_from) + ' to ' + esc(f.test_to) + '</td><td>' + f.rmsle.toFixed(3) + '</td><td>' + f.baseline_rmsle.toFixed(3) + '</td></tr>';
    }).join('');
    var scan = V.lambda_scan.map(function (s) {
      return '<tr><td>' + s.lambda + '</td><td>' + s.w + '</td><td>' + s.pooled_rmsle.toFixed(3) + (s.lambda === V.lambda && s.w === V.blend_w ? ' &larr; chosen' : '') + '</td></tr>';
    }).join('');
    var feats = M.features.map(function (f) {
      return '<tr><td>' + esc(f.name) + '</td><td>' + (f.coef >= 0 ? '+' : '') + f.coef.toFixed(3) + '</td></tr>';
    }).join('');
    return (
      '<details class="method"><summary>THE MODEL AND ITS PROOF — ridge on traded comps, walk-forward folds, bootstrap bands</summary>' +
      '<div class="cols"><div>' +
      '<h3>The fit</h3>' +
      '<p>log(market cap) is regressed on log(TVL), seven-day growth clamped to [-60%, +120%], log(age), log(chain count) and one shrunk indicator per category with at least five comps, then blended with the naive value (TVL times the comps\' median cap/TVL multiple) at weight ' + V.blend_w + ' on the ridge. The ' +
      V.comps + ' comps are every snapshot protocol that already trades with a TVL, a market cap and a tracking start. The penalty lambda and the blend weight are chosen by the walk-forward itself (scan at right), not by taste. A protocol with no recorded start is priced at the comps\' median age of ' + M.median_age_days + ' days.</p>' +
      '<h3>The bands</h3>' +
      '<p>Each value band is the 10th to 90th percentile of 400 bootstrap refits of the comp set, every draw perturbed by the walk-forward\'s pooled out-of-sample spread (sigma ' + V.sigma_oos.toFixed(3) + ' in log space). The band is wide because the proof says the model\'s error is wide; plans are judged against its low end.</p>' +
      '<h3>The plan arithmetic</h3>' +
      '<p>A launch is assumed to distribute ' + Math.round(PC.allocation_share * 100) + '% of implied value to depositors pro-rata. A $' + PC.deposit_usd.toLocaleString('en-US') +
      ' deposit in a protocol with TVL T holds the share 1000/(T+1000) of that pool. Gas follows a stated per-chain schedule, hours are charged at $' + PC.wage_usd_per_hour +
      ', and the deposit forgoes ' + Math.round(PC.opportunity_apy * 100) + '% APY over the hold. FARM needs the band\'s low end net positive; THIN only the midpoint; the rest SKIP.</p>' +
      '<table><tr><th>feature</th><th>coefficient</th></tr>' + feats + '</table>' +
      '</div><div>' +
      '<h3>Walk-forward folds (expanding window, ordered by listing day)</h3>' +
      '<table><tr><th>fold</th><th>train</th><th>test</th><th>test window</th><th>RMSLE</th><th>naive</th></tr>' + folds + '</table>' +
      '<p>Pooled RMSLE ' + V.pooled_rmsle.toFixed(3) + ' (fold sd ' + V.fold_rmsle_sd.toFixed(3) + ') against the naive median-multiple\'s ' + V.baseline_pooled_rmsle.toFixed(3) +
      '. The last fold is the hardest: the newest comps are the wildest, and the radar says so rather than averaging them away.</p>' +
      '<h3>Penalty and blend scan (walk-forward pooled RMSLE)</h3>' +
      '<table><tr><th>lambda</th><th>blend w</th><th>pooled RMSLE</th></tr>' + scan + '</table>' +
      '</div></div></details>'
    );
  }

  // ------------------------------------------------------------------ board

  var logMin = Math.log(Math.min.apply(null, DATA.rows.map(function (r) { return r.value_low_usd; })));
  var logMax = Math.log(Math.max.apply(null, DATA.rows.map(function (r) { return r.value_high_usd; })));
  function bandHtml(r) {
    var span = logMax - logMin || 1;
    var left = ((Math.log(r.value_low_usd) - logMin) / span) * 100;
    var width = Math.max(2, ((Math.log(r.value_high_usd) - Math.log(r.value_low_usd)) / span) * 100);
    var pt = ((Math.log(r.implied_value_usd) - logMin) / span) * 100;
    return '<div class="band" title="band ' + fmtUsd(r.value_low_usd) + ' to ' + fmtUsd(r.value_high_usd) + '">' +
      '<div class="seg" style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%"></div>' +
      '<div class="pt" style="left:' + pt.toFixed(1) + '%"></div></div>';
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  function visibleRows() {
    var rows = DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var va = a[key], vb = b[key];
      if (va === null || va === undefined) va = -Infinity;
      if (vb === null || vb === undefined) vb = -Infinity;
      if (typeof va === 'string') return dir * (va < vb ? -1 : va > vb ? 1 : 0);
      return dir * (va - vb);
    });
    return rows;
  }

  var SORTS = [
    ['rank', '#', 1], ['name', 'Protocol', 1], ['tvl_usd', 'TVL', -1], ['change_7d', '7d', -1],
    ['age_days', 'Age', -1], ['implied_value_usd', 'Implied value (band)', -1], ['net_mid_usd', '$1k net', -1], ['verdict', 'Verdict', 1],
  ];

  function controlsHtml() {
    var cats = categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    function chip(v, label) {
      return '<button class="chip ' + v + '" data-verdict="' + v + '" aria-pressed="' + (state.verdict === v) + '">' + label + '</button>';
    }
    return (
      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search protocols" value="' + esc(state.q) + '" aria-label="Search protocols">' +
      '<select id="cat" aria-label="Category"><option value="all">All categories</option>' + cats + '</select>' +
      chip('all', 'All verdicts') + chip('farm', 'Farm') + chip('thin', 'Thin') + chip('skip', 'Skip') +
      '<label class="watch"><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> watchlist only</label>' +
      '<span class="count" id="count"></span>' +
      '<div class="tabs" role="tablist">' +
      '<button class="tab" data-tab="pre" role="tab" aria-selected="' + (state.tab === 'pre') + '">Pre-token board</button>' +
      '<button class="tab" data-tab="live" role="tab" aria-selected="' + (state.tab === 'live') + '">Already trading (' + DATA.live_size + ')</button>' +
      '</div></div>'
    );
  }

  function boardHtml(rows) {
    var heads = SORTS.map(function (s) {
      var cls = state.sort === s[0] ? ' class="l sorted"' : ' class="l"';
      if (s[0] !== 'name' && s[0] !== 'rank') cls = state.sort === s[0] ? ' class="sorted"' : '';
      if (s[0] === 'rank') cls = state.sort === s[0] ? ' class="sorted"' : '';
      return '<th data-sort="' + s[0] + '"' + cls + '>' + s[1] + (state.sort === s[0] ? (state.dir === 1 ? ' &uarr;' : ' &darr;') : '') + '</th>';
    }).join('');
    var body = rows.map(function (r) {
      return '<tr class="row" data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="l"><span class="name">' + esc(r.name) + '</span>' + (r.watchlist ? ' <span class="watchdot" title="on the snapshot watchlist">&#9679;</span>' : '') +
        '<br><span class="sub">' + esc(r.category || 'uncategorised') + ' &middot; ' + esc(r.chains.slice(0, 3).join(', ') || 'no chain recorded') + '</span></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="l"><span class="num">' + fmtUsd(r.implied_value_usd) + '</span><br>' + bandHtml(r) + '</td>' +
        '<td class="num ' + (r.net_mid_usd >= 0 ? 'pos' : 'neg') + '">' + fmtSigned(r.net_mid_usd) + '<br><span class="sub">low ' + fmtSigned(r.net_low_usd) + '</span></td>' +
        '<td><span class="verdict ' + r.verdict + '">' + r.verdict.toUpperCase() + '</span></td></tr>';
    }).join('');
    return '<table class="board"><thead><tr>' + heads + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function liveHtml() {
    var body = DATA.live.map(function (r) {
      var fit = r.model_log_value === null ? 'n/a' : fmtUsd(r.model_log_value);
      return '<tr><td class="l"><span class="name">' + esc(r.name) + '</span><br><span class="sub">' + esc(r.category || 'uncategorised') + '</span></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num">' + fit + '</td></tr>';
    }).join('');
    return '<p class="sub" style="margin:2px 0 8px">These protocols already trade, so the board never ranks them: it shows the market\'s own cap beside what the fitted model would have said, so the fit can be eyeballed against reality. They are the comps\' world, not the radar\'s targets.</p>' +
      '<table class="board"><thead><tr><th class="l">Protocol</th><th>TVL</th><th>7d</th><th>Market cap (actual)</th><th>Model value</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  // ------------------------------------------------------------------ detail

  function drawerHtml(r) {
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    function kv(k, v) { return '<tr><td class="k">' + k + '</td><td class="v">' + v + '</td></tr>'; }
    return '<div class="scrim" id="scrim"></div><aside class="drawer" aria-label="Protocol detail">' +
      '<button class="close" id="close" aria-label="Close">&times;</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="sub">' + esc(r.category || 'uncategorised') + ' &middot; rank #' + r.rank + ' of ' + DATA.board_size +
      (r.watchlist ? ' &middot; on the snapshot watchlist' : ' &middot; early, below the watchlist floor') + '</div>' +
      '<h3>Implied value if it launched at its record</h3>' +
      '<div class="bigvalue">' + fmtUsd(r.implied_value_usd) + '</div>' +
      '<div class="sub">band ' + fmtUsd(r.value_low_usd) + ' to ' + fmtUsd(r.value_high_usd) + ' (10th to 90th percentile, bootstrap + walk-forward spread)</div>' +
      '<h3>The record</h3><table>' +
      kv('TVL', fmtUsd(r.tvl_usd)) +
      kv('TVL change, 7d', fmtPct(r.change_7d)) +
      kv('Chains', esc(r.chains.length > 10 ? r.chains.slice(0, 10).join(', ') + ' +' + (r.chains.length - 10) + ' more' : r.chains.join(', ') || 'none recorded')) +
      kv('Tracked since', esc(r.listed_at || 'not recorded') + ' (' + fmtAge(r.age_days) + ')') +
      kv('Token', 'none recorded — pre-token') +
      '</table>' +
      '<h3>The $1,000 plan, netted</h3><table>' +
      kv('Verdict', '<span class="verdict ' + r.verdict + '">' + r.verdict.toUpperCase() + '</span>') +
      kv('Deposit sized', fmtUsd(r.deposit_usd) + ', held ' + r.hold_days + ' days') +
      kv('Expected gross (mid / band low)', fmtUsd(r.gross_mid_usd) + ' / ' + fmtUsd(r.gross_low_usd)) +
      kv('All-in cost (gas, time, yield)', fmtUsd(r.total_cost_usd)) +
      kv('Net (mid / band low)', fmtSigned(r.net_mid_usd) + ' / ' + fmtSigned(r.net_low_usd)) +
      '</table>' +
      '<h3>How to farm it</h3><ol>' + steps + '</ol>' +
      '</aside>';
  }

  // ------------------------------------------------------------------ render & wire

  function render() {
    var rows = state.tab === 'pre' ? visibleRows() : [];
    var html = headerHtml() + proofHtml() + methodHtml() + controlsHtml() +
      (state.tab === 'pre' ? boardHtml(rows) : liveHtml()) +
      '<footer><p>Backscatter prices a protocol as if it launched at its current record; it does not predict that a token will be issued, or when. ' +
      'Implied values are this entry\'s own claims, fitted only from the sealed snapshot dated ' + esc(DATA.as_of) + '.</p>' +
      '<p>Method in one line: ridge on ' + V.comps + ' traded comps blended ' + V.blend_w + ' with the median multiple, lambda ' + V.lambda + ' chosen by 5-fold walk-forward (pooled RMSLE ' + V.pooled_rmsle.toFixed(3) +
      '), bands from 400 bootstrap refits plus the walk-forward spread, plans netted at a $' + PC.deposit_usd.toLocaleString('en-US') + ' deposit.</p></footer>';
    var selected = state.selected ? DATA.rows.filter(function (r) { return r.slug === state.selected; })[0] : null;
    app.innerHTML = html + (selected ? drawerHtml(selected) : '');
    app.setAttribute('aria-busy', 'false');
    var count = document.getElementById('count');
    if (count && state.tab === 'pre') count.textContent = rows.length + ' of ' + DATA.board_size + ' shown';

    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; refreshTable(); });
    document.getElementById('cat').addEventListener('change', function (e) { state.category = e.target.value; refreshTable(); });
    document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; refreshTable(); });
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
      c.addEventListener('click', function () { state.verdict = c.getAttribute('data-verdict'); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { state.tab = t.getAttribute('data-tab'); render(); });
    });
    wireTable();
    var close = document.getElementById('close');
    if (close) close.addEventListener('click', function () { state.selected = null; render(); });
    var scrim = document.getElementById('scrim');
    if (scrim) scrim.addEventListener('click', function () { state.selected = null; render(); });
  }

  function wireTable() {
    Array.prototype.forEach.call(document.querySelectorAll('th[data-sort]'), function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else {
          state.sort = key;
          var spec = SORTS.filter(function (s) { return s[0] === key; })[0];
          state.dir = spec ? spec[2] : -1;
        }
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('tr.row'), function (tr) {
      tr.addEventListener('click', function () { state.selected = tr.getAttribute('data-slug'); render(); });
    });
  }

  function refreshTable() {
    // Re-render only the table body region by re-running the full render; the page is small.
    render();
    var q = document.getElementById('q');
    if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  render();
})();
