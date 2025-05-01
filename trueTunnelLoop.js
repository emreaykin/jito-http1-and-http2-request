// persistent-http2-proxy-loop.js
const http2  = require('http2');
const net    = require('net');
const tls    = require('tls');
const fs     = require('fs');
const path   = require('path');
const { URL }= require('url');
const { performance } = require('perf_hooks');

const urlStr ="https://ultra-api.jup.ag/order?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&swapMode=ExactIn";

const REQUIRED_KEYS = [
  'inputMint', 'inAmount', 'outputMint', 'outAmount', 'routePlan'
];

/* ------------------------------------------------------------------ */
function loadProxiesFromFile(filePath = 'proxy.txt') {
  const file = fs.readFileSync(path.resolve(__dirname, filePath), 'utf-8');
  return file
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [ip, port, user, pass] = line.trim().split(':');
      return `http://${user}:${pass}@${ip}:${port}`;
    });
}

function createTunnel(targetHost, targetPort, proxyUrlStr) {
  return new Promise((resolve, reject) => {
    const proxy  = new URL(proxyUrlStr);
    const socket = net.connect(proxy.port, proxy.hostname, () => {
      let req  = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`;
      req     += `Host: ${targetHost}:${targetPort}\r\n`;
      if (proxy.username && proxy.password) {
        const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
        req += `Proxy-Authorization: Basic ${auth}\r\n`;
      }
      req += `\r\n`;
      socket.write(req);
    });

    socket.once('data', chunk => {
      const resp = chunk.toString();
      resp.includes('200') ? resolve(socket)
                           : reject(new Error('Proxy CONNECT failed: ' + resp.split('\r\n')[0]));
    });
    socket.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
// — yardımcılar —
const wait = ms => new Promise(r => setTimeout(r, ms));

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms))
  ]);
}

/* ------------------------------------------------------------------ */
function sendRequestWithClient(client) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const t0     = performance.now();

    const req = client.request({
      ':method': 'GET',
      ':path'  : urlObj.pathname + urlObj.search,
    });

    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const t1   = performance.now();
      try {
        const data = JSON.parse(body);
        // zorunlu alanlar var mı?
        const ok = REQUIRED_KEYS.every(k => data.hasOwnProperty(k));
        return ok ? resolve(t1 - t0)
                  : reject(new Error('Yanıt formatı beklenen değil'));
      } catch (_) {
        reject(new Error('JSON parse hatası'));
      }
    });
    req.on('error', reject);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
// — ana döngü —
async function runLoop(clients, round = 1) {
  console.log(`🌀 Döngü ${round}`);

  let success = 0;
  const times = [];

  await Promise.all(clients.map(async (client, idx) => {
    try {
      const t = await withTimeout(sendRequestWithClient(client), 1500);
      success++;
      times.push(t);
    } catch (err) {
      console.error(`Proxy #${idx + 1} → Hata: ${err.message}`);
    }
  }));

  const max  = times.length ? Math.max(...times) : 0;
  console.log(`⏱ Başarılı istek: ${success}/${clients.length}`);
  console.log(`🚀 En uzun süre: ${max.toFixed(2)} ms`);
  console.log('-----------------------------------------------------\n');

  // 1 sn’den erken bittiyse, aradaki fark kadar bekle
  const delay = max < 1000 ? 1000 - max : 0;
  await wait(delay);
  return runLoop(clients, round + 1);  // sıradaki döngü
}

/* ------------------------------------------------------------------ */
// — giriş noktası —
(async () => {
  const proxies = loadProxiesFromFile('proxy.txt');
  const urlObj  = new URL(urlStr);

  const clients = await Promise.all(
    proxies.map(async (proxy, i) => {
      const t0 = performance.now();
      try {
        const socket = await createTunnel(urlObj.hostname, 443, proxy);
        const tlsSocket = await new Promise((res, rej) => {
          const s = tls.connect({
            socket,
            servername   : urlObj.hostname,
            ALPNProtocols: ['h2'],
          });
          s.on('secureConnect', () => res(s));
          s.on('error', rej);
        });

        const client = http2.connect(urlObj.origin, {
          createConnection: () => tlsSocket,
        });
        client.on('error', e => console.error(`Client #${i + 1} H2 err:`, e.message));

        const dt = performance.now() - t0;
        console.log(`✅ Proxy #${i + 1} tünel hazır → ${dt.toFixed(2)} ms`);

        return client;
      } catch (err) {
        console.error(`❌ Proxy #${i + 1} açılmadı:`, err.message);
        return null;
      }
    })
  );

  const valid = clients.filter(Boolean);
  if (!valid.length) {
    console.error('Çalışacak proxy bulunamadı.');
    process.exit(1);
  }

  console.log(`\n🔁 Sürekli istek döngüsü başlıyor…\n`);
  await runLoop(valid);
})();
