const https = require('https');
const http2 = require('http2');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');
const { HttpsProxyAgent } = require('https-proxy-agent');


const urlStr = 'https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=200&swapMode=ExactIn&onlyDirectRoutes=false&asLegacyTransaction=false&maxAccounts=28&minimizeSlippage=false';

// Proxy bilgileri: IP: 204.9.38.199, port: 6520, kullanıcı: wnavunoo, şifre: mq0c797a6zxz
const proxyUrl = 'http://wnavunoo:mq0c797a6zxz@104.239.108.103:6338';

//
// HTTP/1.1 için proxy kullanarak istek gönderimi
//
function requestHTTP1ViaProxy() {
  return new Promise((resolve, reject) => {
    const start = process.hrtime();
    // https-proxy-agent ile proxy'yi tanımlıyoruz.
    const agent = new HttpsProxyAgent(proxyUrl);
    https.get(urlStr, { agent }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const diff = process.hrtime(start);
        const responseTime = diff[0] * 1000 + diff[1] / 1e6;
        console.log("HTTP/1.1 (Proxy) Response Body:");
        console.log(body);
        resolve(responseTime);
      });
    }).on('error', (err) => reject(err));
  });
}

//
// HTTP CONNECT tüneli oluşturmak için: Proxy üzerinden hedefe bağlanmayı sağlar
//
function createTunnel(targetHost, targetPort, proxyUrlStr) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrlStr);
    // Proxy'ye bağlanıyoruz
    const socket = net.connect(proxy.port, proxy.hostname, () => {
      // CONNECT isteği hazırlıyoruz
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

//
// HTTP/2 için proxy kullanarak istek gönderimi
//
function requestHTTP2ViaProxy() {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const targetPort = urlObj.port || 443; // HTTPS varsayılan portu
    createTunnel(urlObj.hostname, targetPort, proxyUrl)
      .then((socket) => {
        // Proxy tüneli üzerinden hedefe TLS ile bağlanıyoruz.
        const tlsSocket = tls.connect({
          socket: socket,
          servername: urlObj.hostname,
          ALPNProtocols: ['h2']  // HTTP/2 protokolünü zorlamak için ALPN seçeneği ekleniyor
        }, () => {
          // TLS handshake başarılı olduktan sonra HTTP/2 istemci oturumu oluşturuyoruz.
          const client = http2.connect(urlObj.origin, {
            createConnection: () => tlsSocket,
          });
          client.on('error', reject);

          const start = process.hrtime();
          const req = client.request({
            ':method': 'GET',
            ':path': urlObj.pathname + urlObj.search,
          });
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', () => {
            const diff = process.hrtime(start);
            const responseTime = diff[0] * 1000 + diff[1] / 1e6;
            console.log("HTTP/2 (Proxy) Response Body:");
            console.log(body);
            client.close();
            resolve(responseTime);
          });
          req.on('error', reject);
          req.end();
        });
        tlsSocket.on('error', reject);
      })
      .catch(reject);
  });
}


//
// İstekleri sırayla çalıştıran ana fonksiyon
//
async function runRequests() {
  try {
    console.log('HTTP/1.1 isteği (Proxy) gönderiliyor...');
    const time1 = await requestHTTP1ViaProxy();
    console.log(`HTTP/1.1 (Proxy) Response Süresi: ${time1.toFixed(2)} ms\n`);

    console.log('HTTP/2 isteği (Proxy) gönderiliyor...');
    const time2 = await requestHTTP2ViaProxy();
    console.log(`HTTP/2 (Proxy) Response Süresi: ${time2.toFixed(2)} ms\n`);
  } catch (err) {
    console.error('Hata:', err);
  }
}

runRequests();
