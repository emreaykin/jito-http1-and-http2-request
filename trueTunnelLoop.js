// persistent-http2-proxy-loop.js
const http2  = require('http2');
const net    = require('net');
const tls    = require('tls');
const fs     = require('fs');
const path   = require('path');
const { URL }= require('url');
const { performance } = require('perf_hooks');

const urlStr = 'https://ultra-api.jup.ag/order?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&swapMode=ExactIn';
const REQUIRED_KEYS = ['inputMint','inAmount','outputMint','outAmount','routePlan'];

const BATCH_SIZE   = 500;   // ⬅️ tek seferde atılacak istek sayısı
const REQ_TIMEOUT  = 1100;  // ms
const MIN_LOOP_GAP = 1100;  // ms – bir tur < 1 sn sürerse arayı doldur

/* -------------------------------------------------- */
function loadProxiesFromFile(filePath='proxy.txt'){
  return fs.readFileSync(path.resolve(__dirname,filePath),'utf8')
           .trim()
           .split(/\r?\n/)
           .filter(Boolean)
           .map(l=>{
             const [ip,port,user,pass] = l.trim().split(':');
             return `http://${user}:${pass}@${ip}:${port}`;
           });
}

function createTunnel(targetHost,targetPort,proxyUrlStr){
  return new Promise((res,rej)=>{
    const proxy  = new URL(proxyUrlStr);
    const socket = net.connect(proxy.port,proxy.hostname,()=>{
      let req = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`
              + `Host: ${targetHost}:${targetPort}\r\n`;
      if(proxy.username && proxy.password){
        const auth = Buffer.from(`${proxy.username}:${proxy.password}`)
                           .toString('base64');
        req += `Proxy-Authorization: Basic ${auth}\r\n`;
      }
      socket.write(req + '\r\n');
    });
    socket.once('data',chunk=>{
      const ok = /^HTTP\/1\.\d 200 /.test(chunk.toString());
      ok ? res(socket)
         : rej(new Error('Proxy CONNECT başarısız'));
    });
    socket.on('error',rej);
  });
}

const wait = ms => new Promise(r=>setTimeout(r,ms));
const withTimeout = (p,ms)=>
  Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('Timeout')),ms))]);

function sendRequestWithClient(client){
  return new Promise((res,rej)=>{
    const urlObj = new URL(urlStr);
    const t0 = performance.now();
    const req = client.request({
      ':method':'GET',
      ':path'  :urlObj.pathname + urlObj.search
    });
    let body='';
    req.setEncoding('utf8');
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      const t1 = performance.now();
      try{
        const data = JSON.parse(body);
        const ok = REQUIRED_KEYS.every(k=>data.hasOwnProperty(k));
        ok ? res(t1-t0) : rej(new Error('Yanıt formatı beklenen değil'));
      }catch(_){ rej(new Error('JSON parse hatası')); }
    });
    req.on('error',rej);
    req.end();
  });
}

/* ------------------ Ana döngü --------------------- */
async function runLoop(clients,start=0,round=1){
  // batch dizisini halkalı (circular) şekilde oluştur
  const batch = [];
  for(let i=0;i<Math.min(BATCH_SIZE,clients.length);i++){
    const idx = (start+i) % clients.length;
    batch.push({idx,client:clients[idx]});
  }

  log(`🌀 Döngü ${round} (proxy #${batch[0].idx+1} → #${batch.at(-1).idx+1})`);

  let success=0;
  const times=[];
  await Promise.all(batch.map(async ({client,idx})=>{
    try{
      const t = await withTimeout(sendRequestWithClient(client),REQ_TIMEOUT);
      success++; times.push(t);
    }catch(e){
      logErr(`Proxy #${idx+1} → Hata: ${e.message}`);
    }
  }));

  const max = times.length ? Math.max(...times) : 0;
  log(`⏱ Başarılı istek: ${success}/${batch.length}`);
  log(`🚀 En uzun süre:  ${max.toFixed(2)} ms\n`);

  // Minimum 1 sn aralık
  if(max < MIN_LOOP_GAP) await wait(MIN_LOOP_GAP - max);

  // Sonraki pencere
  return runLoop(clients,(start+BATCH_SIZE)%clients.length,round+1);
}

/* -------------------- Giriş ----------------------- */
(async()=>{
  const proxies = loadProxiesFromFile('proxy.txt');
  const urlObj  = new URL(urlStr);

  const clients = await Promise.all(proxies.map(async (proxy,i)=>{
    const t0 = performance.now();
    try{
      const raw = await createTunnel(urlObj.hostname,443,proxy);
      const tlsSock = await new Promise((res,rej)=>{
        const s = tls.connect({socket:raw,servername:urlObj.hostname,ALPNProtocols:['h2']});
        s.once('secureConnect',()=>res(s));
        s.on('error',rej);
      });
      const client = http2.connect(urlObj.origin,{createConnection:()=>tlsSock});
      client.on('error',e=>logErr(`Client #${i+1} H2 err: ${e.message}`));
      log(`✅ Proxy #${i+1} tünel hazır → ${(performance.now()-t0).toFixed(2)} ms`);
      return client;
    }catch(err){
      logErr(`❌ Proxy #${i+1} açılmadı: ${err.message}`);
      return null;
    }
  }));

  const valid = clients.filter(Boolean);
  if(!valid.length){
    logErr('Çalışacak proxy bulunamadı.'); process.exit(1);
  }

  log(`\n🔁 Sürekli istek döngüsü başlıyor…\n`);
  await runLoop(valid);
})();


/* -------------------------------------------------- */
/*  EK: Zaman damgalı log yardımcıları                */
/* -------------------------------------------------- */
// YYYY-MM-DD HH:mm:ss.SSS  (Türkiye saati)
function timestampTR() {
  const now = new Date();
  // Intl API – Node v18+ “fractionalSecondDigits” destekli
  return now.toLocaleString('tr-TR', {
    timeZone:              'Europe/Istanbul',
    hour12:                false,
    year:                  'numeric',
    month:                 '2-digit',
    day:                   '2-digit',
    hour:                  '2-digit',
    minute:                '2-digit',
    second:                '2-digit',
    fractionalSecondDigits: 3     // ← milisaniye
  });
}

function log(...msg)    { console.log (`${timestampTR()} |`, ...msg); }
function logErr(...msg) { console.error(`${timestampTR()} |`, ...msg); }
