const https = require('https');
const http2 = require('http2');

const url = 'https://amsterdam.mainnet.block-engine.jito.wtf';

// HTTP/1.1 isteği gönderen fonksiyon
function requestHTTP1() {
  return new Promise((resolve, reject) => {
    const start = process.hrtime(); // Başlangıç zamanını al
    https.get(url, (res) => {
      // Gelen veriyi alıyoruz (veriyi kullanmıyoruz)
      res.on('data', () => {});
      res.on('end', () => {
        const diff = process.hrtime(start);
        // Milisaniyeye çeviriyoruz: saniye * 1000 + nanosecond/1e6
        const responseTime = diff[0] * 1000 + diff[1] / 1e6;
        resolve(responseTime);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// HTTP/2 isteği gönderen fonksiyon
function requestHTTP2() {
  return new Promise((resolve, reject) => {
    // HTTP/2 üzerinden bağlantı kuruyoruz
    const client = http2.connect(url);
    client.on('error', (err) => reject(err));

    const start = process.hrtime();
    // Pseudo header'lar kullanarak GET isteği gönderiyoruz
    const req = client.request({
      ':method': 'GET',
      ':path': '/',
    });

    req.setEncoding('utf8');
    req.on('data', () => {}); // Gelen veriyi dinliyoruz ama kullanmıyoruz
    req.on('end', () => {
      const diff = process.hrtime(start);
      const responseTime = diff[0] * 1000 + diff[1] / 1e6;
      client.close(); // Bağlantıyı kapatıyoruz
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
    console.log(`HTTP/1.1 Response Süresi: ${time1.toFixed(2)} ms`);

    console.log('HTTP/2 isteği gönderiliyor...');
    const time2 = await requestHTTP2();
    console.log(`HTTP/2 Response Süresi: ${time2.toFixed(2)} ms`);
  } catch (err) {
    console.error('Hata:', err);
  }
}

runRequests();
