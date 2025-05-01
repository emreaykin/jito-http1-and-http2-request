const http2 = require('http2');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const urlStr = 'https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=200&swapMode=ExactIn&onlyDirectRoutes=false&asLegacyTransaction=false&maxAccounts=28&minimizeSlippage=false';

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
    const proxy = new URL(proxyUrlStr);
    const socket = net.connect(proxy.port, proxy.hostname, () => {
      let connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`;
      connectReq += `Host: ${targetHost}:${targetPort}\r\n`;
      if (proxy.username && proxy.password) {
        const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
        connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
      }
      connectReq += `\r\n`;
      socket.write(connectReq);
    });
    socket.once('data', (chunk) => {
      const response = chunk.toString();
      if (response.indexOf('200') !== -1) {
        resolve(socket);
      } else {
        reject(new Error('Proxy CONNECT failed: ' + response));
      }
    });
    socket.on('error', reject);
  });
}

// Persistent client ile HTTP/2 request gönder
function sendRequestWithClient(client) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const start = process.hrtime();

    const req = client.request({
      ':method': 'GET',
      ':path': urlObj.pathname + urlObj.search,
    });

    req.setEncoding('utf8');
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const diff = process.hrtime(start);
      const time = diff[0] * 1000 + diff[1] / 1e6;
      resolve(time);
    });
    req.on('error', reject);
    req.end();
  });
}

async function startPersistentLoop(clients, intervalMs = 2000) {
  console.log(`\n🔁 Sürekli istek döngüsü başlıyor... (her ${intervalMs} ms'de bir)\n`);

  let counter = 1;
  let totalRequests = 0;

  setInterval(async () => {
    console.log(`🌀 Döngü ${counter++}`);

    let successfulThisRound = 0;

    const results = await Promise.all(
      clients.map((client, i) => {
        return sendRequestWithClient(client)
          .then(time => {
            successfulThisRound++;
            totalRequests++;
            console.log(`Proxy #${i + 1} → Süre: ${time.toFixed(2)} ms`);
            return time;
          })
          .catch(err => {
            console.error(`Proxy #${i + 1} → Hata: ${err.message}`);
            return 0;
          });
      })
    );

    const max = Math.max(...results);
    console.log(`⏱ Bu turda atılan istek sayısı: ${successfulThisRound}`);
    console.log(`📦 Toplam istek sayısı: ${totalRequests}`);
    console.log(`🚀 En uzun süre: ${max.toFixed(2)} ms`);
    console.log('-----------------------------------------------------\n');
  }, intervalMs);
}



// Giriş noktası
(async () => {
  const proxies = loadProxiesFromFile('proxy.txt');
  const urlObj = new URL(urlStr);

  // Her proxy için kalıcı bağlantılar kur
  const clients = await Promise.all(
    proxies.map(async (proxy, i) => {
      try {
        const socket = await createTunnel(urlObj.hostname, 443, proxy);
        const tlsSocket = await new Promise((resolve, reject) => {
          const tlsSock = tls.connect({
            socket,
            servername: urlObj.hostname,
            ALPNProtocols: ['h2'],
          });
          tlsSock.on('secureConnect', () => resolve(tlsSock));
          tlsSock.on('error', reject);
        });

        const client = http2.connect(urlObj.origin, {
          createConnection: () => tlsSocket,
        });

        client.on('error', err => console.error(`Client #${i + 1} HTTP/2 error:`, err.message));
        return client;
      } catch (err) {
        console.error(`Proxy ${i + 1} bağlantı kurulamadı:`, err.message);
        return null;
      }
    })
  );

  // Geçerli client'larla döngüyü başlat
  const validClients = clients.filter(Boolean);
  await startPersistentLoop(validClients, 2000); // her 2 saniyede bir döner
})();
