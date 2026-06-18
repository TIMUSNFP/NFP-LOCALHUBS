'use strict';
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

const PORT   = 3001;
const ROOT   = __dirname;
const SCRIPT = path.join(ROOT, 'script.js');
const IMG    = path.join(ROOT, 'Images', 'MapChart_Map.png');
const EDITOR = path.join(ROOT, 'pin-editor.html');

// ── Read HUB_CITIES from script.js ──────────────────────────────────────────
function readCities() {
    const src   = fs.readFileSync(SCRIPT, 'utf8');
    const block = src.match(/const HUB_CITIES\s*=\s*\[([\s\S]*?)\];/);
    if (!block) throw new Error('HUB_CITIES not found in script.js');
    const cities = [];
    const re = /\{\s*name\s*:\s*'([^']+)'\s*,\s*lat\s*:\s*([\d.]+)\s*,\s*lng\s*:\s*([\d.]+)\s*,\s*delay\s*:\s*([\d.]+)\s*,\s*lg\s*:\s*(true|false)\s*,\s*lbl\s*:\s*'([^']+)'\s*\}/g;
    let m;
    while ((m = re.exec(block[0])) !== null) {
        cities.push({
            name:  m[1],
            lat:   parseFloat(m[2]),
            lng:   parseFloat(m[3]),
            delay: parseFloat(m[4]),
            lg:    m[5] === 'true',
            lbl:   m[6]
        });
    }
    return cities;
}

// ── Write updated HUB_CITIES back to script.js ───────────────────────────────
function writeCities(cities) {
    const src   = fs.readFileSync(SCRIPT, 'utf8');
    const lines = cities.map(c => {
        const latFmt = (c.lat < 10 ? ' ' : '') + c.lat.toFixed(2);
        const lgFmt  = c.lg ? 'true ' : 'false';
        const name   = ("'" + c.name + "'").padEnd(13);
        return `    { name:${name}, lat:${latFmt}, lng:${c.lng.toFixed(2)}, delay:${c.delay.toFixed(1)}, lg:${lgFmt}, lbl:'${c.lbl}'  }`;
    });
    const replacement = `const HUB_CITIES = [\n${lines.join(',\n')}\n];`;
    const updated = src.replace(/const HUB_CITIES\s*=\s*\[[\s\S]*?\];/, replacement);
    if (updated === src) throw new Error('Replacement had no effect — regex may need update.');
    fs.writeFileSync(SCRIPT, updated, 'utf8');
}

// ── Git commit & push ────────────────────────────────────────────────────────
function gitPush() {
    execSync('git add script.js', { cwd: ROOT, stdio: 'pipe' });
    try {
        execSync('git commit -m "Update hero map pin positions via pin editor"', { cwd: ROOT, stdio: 'pipe' });
    } catch (e) {
        const msg = (e.stdout || '').toString() + (e.stderr || '').toString();
        if (!msg.includes('nothing to commit')) throw e;
    }
    execSync('git push origin master', { cwd: ROOT, stdio: 'pipe' });
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function json(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
}

// ── Server ───────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(EDITOR, 'utf8'));

    } else if (req.method === 'GET' && req.url === '/map') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(fs.readFileSync(IMG));

    } else if (req.method === 'GET' && req.url === '/api/cities') {
        try   { json(res, 200, readCities()); }
        catch (e) { json(res, 500, { error: e.message }); }

    } else if (req.method === 'POST' && req.url === '/api/save') {
        let body = '';
        req.on('data', c => body += c.toString());
        req.on('end', () => {
            try {
                writeCities(JSON.parse(body));
                gitPush();
                json(res, 200, { ok: true, message: 'Saved & pushed to GitHub! Vercel will deploy in ~30 s.' });
            } catch (e) {
                json(res, 500, { ok: false, message: e.message || String(e) });
            }
        });

    } else {
        res.writeHead(404); res.end('Not found');
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║   NFP Circles — Map Pin Editor       ║');
    console.log(`  ║   http://localhost:${PORT}              ║`);
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    console.log('  Open the URL above in your browser.');
    console.log('  Press Ctrl+C to stop the server.');
    console.log('');
});
