// http2-proxy-loop-with-timeout.js

const fs = require('fs');
const path = require('path');
const http2 = require('http2');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');

const TARGET = new URL(
  'https://quote-api.jup.ag/v6/quote'
  + '?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  + '&outputMint=So11111111111111111111111111111111111111112'
  + '&amount=1000000'
  + '&slippageBps=200'
  + '&swapMode=ExactIn'
  + '&onlyDirectRoutes=false'
  + '&asLegacyTransaction=false'
  + '&maxAccounts=28'
  + '&minimizeSlippage=false'
);

const TIMEOUT_MS = 5000;  // 5 saniye zaman aşımı

function loadProxies(file = 'tunnel.txt') {
  const lines = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('http://') && l.includes('@'));
  console.log(`🗂 ${lines.length} proxy yüklendi.`);
  return lines;
}

function createTunnel(host, port, proxyUrl) {
  return new Promise((resolve, reject) => {
    const p = new URL(proxyUrl);
    const sock = net.connect(p.port, p.hostname, () => {
      let req = `CONNECT ${host}:${port} HTTP/1.1\r\n`;
      req += `Host: ${host}:${port}\r\n`;
      if (p.username) {
        const auth = Buffer.from(`${p.username}:${p.password}`).toString('base64');
        req += `Proxy-Authorization: Basic ${auth}\r\n`;
      }
      req += `\r\n`;
      sock.write(req);
    });
    sock.once('data', chunk => {
      const res = chunk.toString();
      if (res.startsWith('HTTP/') && res.includes('200')) return resolve(sock);
      reject(new Error(res.split('\r\n')[0] || res));
    });
    sock.on('error', reject);
  });
}

function requestHTTP2ViaProxy(proxyUrl) {
  // Orijinal promise + timeout
  const p = new Promise((resolve, reject) => {
    createTunnel(TARGET.hostname, TARGET.port || 443, proxyUrl)
      .then(raw => {
        const tlsSock = tls.connect({
          socket: raw,
          servername: TARGET.hostname,
          ALPNProtocols: ['h2']
        }, () => {
          const client = http2.connect(TARGET.origin, {
            createConnection: () => tlsSock
          });
          client.on('error', err => {
            client.destroy();
            reject(err);
          });
          const req = client.request({
            ':method': 'GET',
            ':path': TARGET.pathname + TARGET.search
          });
          req.on('error', err => {
            client.destroy();
            reject(err);
          });
          req.on('end', () => {
            client.close();
            resolve();
          });
          // data’yı gerçekten okumaya gerek yok, ama consume etmek lazım
          req.on('data', () => {});
          req.end();
        });
        tlsSock.on('error', reject);
      })
      .catch(reject);
  });

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('⏱ Zaman aşımı')), TIMEOUT_MS)
  );

  return Promise.race([p, timeout]);
}

async function startLoop() {
  const proxies = loadProxies('tunnel.txt');
  if (!proxies.length) return;

  let round = 1;
  setInterval(async () => {
    let success = 0, fail = 0;
    console.log(`\n🌀 Döngü ${round++}`);

    await Promise.all(proxies.map(async (px, i) => {
      try {
        await requestHTTP2ViaProxy(px);
        success++;
      } catch (err) {
        fail++;
        console.error(`❌ Proxy #${i + 1} (${px}) hatası: ${err.message}`);
      }
    }));

    console.log(`✅ Başarılı: ${success}`);
    console.log(`❌ Başarısız: ${fail}`);
    console.log('----------------------------------------------');
  }, 1000);
}

startLoop();
