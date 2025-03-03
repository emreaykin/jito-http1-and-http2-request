const https = require('https');
const http2 = require('http2');

const urlStr = 'https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=200&swapMode=ExactIn&onlyDirectRoutes=false&asLegacyTransaction=false&maxAccounts=28&minimizeSlippage=false';

// HTTP/1.1 isteği gönderen fonksiyon (HTTP/2 otomatik devre dışı bırakılarak)
function requestHTTP1() {
  return new Promise((resolve, reject) => {
    const start = process.hrtime();
    https.get(urlStr, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        const diff = process.hrtime(start);
        const responseTime = diff[0] * 1000 + diff[1] / 1e6;
        console.log("HTTP/1.1 Response Body:");
        console.log(body);
        resolve(responseTime);
      });
    }).on('error', (err) => reject(err));
  });
}

// HTTP/2 isteği gönderen fonksiyon (doğru path: yol ve sorgu parametreleri)
function requestHTTP2() {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const client = http2.connect(urlObj.origin);
    client.on('error', (err) => reject(err));

    const start = process.hrtime();
    const req = client.request({
      ':method': 'GET',
      ':path': urlObj.pathname + urlObj.search,
    });

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const diff = process.hrtime(start);
      const responseTime = diff[0] * 1000 + diff[1] / 1e6;
      console.log("HTTP/2 Response Body:");
      console.log(body);
      client.close();
      resolve(responseTime);
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

// İstekleri sırayla çalıştıran ana fonksiyon
async function runRequests() {
  try {
    console.log('HTTP/1.1 isteği gönderiliyor...');
    const time1 = await requestHTTP1();
    console.log(`HTTP/1.1 Response Süresi: ${time1.toFixed(2)} ms\n`);

    console.log('HTTP/2 isteği gönderiliyor...');
    const time2 = await requestHTTP2();
    console.log(`HTTP/2 Response Süresi: ${time2.toFixed(2)} ms\n`);
  } catch (err) {
    console.error('Hata:', err);
  }
}

runRequests();
