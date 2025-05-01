// proxy-tunnel-batched.js
import fs   from "fs";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { performance } from "perf_hooks";

const PROXY_FILE = "./proxy.txt";
const ROUNDS     = 30;          // kaç tur denenecek
const TIMEOUT_MS = 6_000;      // her istek için timeout
const TARGET_URL =
  "https://quote-api.jup.ag/v6/quote" +
  "?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" +
  "&outputMint=So11111111111111111111111111111111111111112" +
  "&amount=1000000&slippageBps=200&swapMode=ExactIn" +
  "&onlyDirectRoutes=false&asLegacyTransaction=false" +
  "&maxAccounts=28&minimizeSlippage=false";

/* ---------------------------------------------------------- */
/* 1) proxy.txt -> { url, agent }                             */
/* ---------------------------------------------------------- */
const proxyEntries = fs
  .readFileSync(PROXY_FILE, "utf-8")
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(Boolean)
  .map(line => {
    const [ip, port, user, pass] = line.split(":");
    const url = `http://${user}:${pass}@${ip}:${port}`;

    // 🔧 DÜZELTİLMİŞ: proxy-URL ilk argüman, opsiyonlar ikinci argüman
    const agent = new HttpsProxyAgent(
      url,
      {
        keepAlive:      true,
        keepAliveMsecs: 60_000
      }
    );

    return { url, agent };
  });

/* ---------------------------------------------------------- */
/* 2) Tünelleri önceden kur – “ısıtma”                        */
/* ---------------------------------------------------------- */
async function warmUpTunnels() {
  const warmTasks = proxyEntries.map(({ agent }) =>
    fetch(TARGET_URL, { agent, method: "HEAD" }).catch(() => {})
  );
  await Promise.allSettled(warmTasks);
}

/* ---------------------------------------------------------- */
/* 3) Tek istek – süre ölç, hata fırlat                       */
/* ---------------------------------------------------------- */
async function timedRequest(agent) {
  const ctrl  = new AbortController();
  const start = performance.now();
  const to    = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(TARGET_URL, { agent, signal: ctrl.signal });
    clearTimeout(to);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.inputMint || !json.outputMint || !json.outAmount)
      throw new Error("Geçersiz Jupiter yanıtı");

    return performance.now() - start;           // ms
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

/* ---------------------------------------------------------- */
/* 4) 3 turluk paralel test                                   */
/* ---------------------------------------------------------- */
async function runBatchedRounds() {
  console.log(`🚀 ${proxyEntries.length} proxy, ${ROUNDS} tur.\n`);
  await warmUpTunnels();
  console.log("🔗 Tüm tüneller hazır, test başlıyor…\n");

  for (let round = 1; round <= ROUNDS; round++) {
    const tasks = proxyEntries.map(({ url, agent }) =>
      timedRequest(agent).catch(err => ({ url, err }))
    );

    const results   = await Promise.all(tasks);
    const durations = results.filter(r => typeof r === "number");
    const failures  = results.filter(r => typeof r === "object");

    if (durations.length === 0) {
      console.log(`❌ [Tur ${round}] Hiç başarılı yanıt yok.`);
    } else {
      const slowest = Math.max(...durations);
      console.log(
        `🗒️  [Tur ${round}] başarılı ${durations.length
        } / ${proxyEntries.length}, en geç ${slowest.toFixed(0)} ms`
      );
    }

    failures.forEach(f =>
      console.log(`   ❌ ${f.url} → ${f.err.message}`)
    );
    console.log("");
  }

  proxyEntries.forEach(({ agent }) => agent.destroy());
}

runBatchedRounds().catch(console.error);
