const http2 = require("http2");

const urlStr =
  "https://ultra-api.jup.ag/order?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&swapMode=ExactIn";

function requestHTTP2() {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const client = http2.connect(urlObj.origin);
    client.on("error", (err) => reject(err));

    const start = process.hrtime();
    const req = client.request({
      ":method": "GET",
      ":path": urlObj.pathname + urlObj.search,
    });

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const diff = process.hrtime(start);
      const responseTime = diff[0] * 1000 + diff[1] / 1e6;
      client.close();
      resolve({ body, responseTime });
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function loopRequests(intervalMs = 1000) {
  let counter = 1;
  while (true) {
    console.log(`🔁 Döngü ${counter}`);
    const start = Date.now();
    try {
      const { body, responseTime } = await requestHTTP2();
      console.log(`✅ Yanıt süresi: ${responseTime.toFixed(2)} ms`);
    } catch (err) {
      console.error(`❌ Hata:`, err.message);
    }

    const elapsed = Date.now() - start;
    const waitTime = Math.max(0, intervalMs - elapsed);
    if (waitTime > 0) await delay(waitTime);
    counter++;
  }
}

loopRequests(1000); // 1000 ms aralıkla çalıştır
