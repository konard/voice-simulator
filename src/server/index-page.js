/** Minimal HTML page served by `voice-simulator serve` at "/". */

export const INDEX_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>voice-simulator server</title>
<style>
body { font: 16px system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; }
textarea { width: 100%; min-height: 5rem; font: inherit; }
code { background: #eee; padding: 0 .3em; }
</style>
</head>
<body>
<h1>voice-simulator</h1>
<p>Speech simulated by sound waves travelling through a parametric 3D head.</p>
<form id="form">
<textarea id="text">Hello! Привет! नमस्ते! 你好！</textarea>
<p>
<label>Tier <select id="tier">
<option>minimal</option><option>low</option><option selected>medium</option>
<option>high</option><option>ultra</option>
</select></label>
<label>Seed <input id="seed" value="1" size="8"></label>
<button>Speak (streamed)</button>
</p>
</form>
<p id="ipa"></p>
<audio id="audio" controls></audio>
<h2>API</h2>
<ul>
<li><code>GET /api/health</code></li>
<li><code>GET /api/languages</code>, <code>GET /api/tiers</code></li>
<li><code>GET /api/ipa?text=…&amp;lang=auto</code></li>
<li><code>GET /api/head/random?seed=…</code></li>
<li><code>GET /api/mesh.obj?seed=…&amp;lod=0..3</code></li>
<li><code>GET|POST /api/synthesize</code> (WAV), <code>GET|POST /api/stream</code> (streamed WAV)</li>
</ul>
<script>
const $ = (id) => document.getElementById(id);
$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = new URLSearchParams({
    text: $('text').value, tier: $('tier').value, seed: $('seed').value,
    head: 'random',
  });
  const info = await fetch('/api/ipa?' + query).then((r) => r.json());
  $('ipa').textContent = info.error || '[' + info.lang + '] /' + info.ipa + '/';
  $('audio').src = '/api/stream?' + query;
  $('audio').play();
});
</script>
</body>
</html>
`;
