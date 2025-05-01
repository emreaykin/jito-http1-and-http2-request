const http2 = require('http2');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Target URL
const urlStr = 'https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=200&swapMode=ExactIn&onlyDirectRoutes=false&asLegacyTransaction=false&maxAccounts=28&minimizeSlippage=false';

// 1) tunnel.txt dosyasından proxy URL'lerini oku
const proxies = fs.readFileSync(path.resolve(__dirname, 'tunnel.txt'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line.length > 0);

// 2) CONNECT tüneli açmak için yardımcı fonksiyon
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

    socket.once('data', chunk => {
      const response = chunk.toString();
      if (response.includes('200')) {
        resolve(socket);
      } else {
        reject(new Error('Proxy CONNECT failed: ' + response));
      }
    });

    socket.on('error', reject);
  });
}

// 3) HTTP/2 üzerinden proxy ile istek atma fonksiyonu
function requestHTTP2ViaProxy(proxyUrl) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const targetPort = urlObj.port || 443;

    createTunnel(urlObj.hostname, targetPort, proxyUrl)
      .then(socket => {
        const tlsSocket = tls.connect({
          socket,
          servername: urlObj.hostname,
          ALPNProtocols: ['h2']
        }, () => {
          const client = http2.connect(urlObj.origin, {
            createConnection: () => tlsSocket
          });
          client.on('error', reject);

          const start = process.hrtime();
          const req = client.request({
            ':method': 'GET',
            ':path': urlObj.pathname + urlObj.search
          });

          let body = '';
          req.setEncoding('utf8');
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            const diff = process.hrtime(start);
            const responseTime = diff[0] * 1000 + diff[1] / 1e6;
            client.close();
            resolve({ proxy: proxyUrl, time: responseTime, body });
          });

          req.on('error', reject);
          req.end();
        });

        tlsSocket.on('error', reject);
      })
      .catch(reject);
  });
}

// 4) Eş zamanlı tüm proxy'leri test eden ana fonksiyon
async function runRequestsConcurrently() {
  const tasks = proxies.map(proxy =>
    requestHTTP2ViaProxy(proxy)
      .then(({ proxy, time ,body}) => {
        console.log(`✅ ${proxy} → ${time.toFixed(2)} ms body : ${body}`);
      })
      .catch(err => {
        console.error(`❌ ${proxy} error: ${err.message}`);
      })
  );

  // Tüm istekler tamamlanana kadar bekle
  await Promise.all(tasks);
  console.log('All HTTP/2 requests completed.');
}

runRequestsConcurrently();
