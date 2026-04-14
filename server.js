const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const axios = require("axios");

const app = express();
app.use(cors());

const cache = new Map();

function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;

  if (Date.now() > item.expire) {
    cache.delete(key);
    return null;
  }

  return item.data;
}

function setCache(key, data, ttl = 1000 * 60 * 60) {
  cache.set(key, {
    data,
    expire: Date.now() + ttl,
  });
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/official|video|ao vivo|live|clipe|hd/gi, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(text) {
  return normalize(text).replace(/\s+/g, "-");
}

async function buscarCifraCifraClub(title, artist) {
  const cacheKey = `cifra-${title}-${artist}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  try {
    const query = `${title} ${artist}`;

    await page.goto(
      `https://www.cifraclub.com.br/?q=${encodeURIComponent(query)}`,
      { waitUntil: "networkidle2" }
    );

    const link = await page.evaluate(() => {
      const anchors = document.querySelectorAll("a");

      for (let a of anchors) {
        const href = a.href;
        if (!href) continue;

        if (
          href.includes("cifraclub.com.br") &&
          !href.includes("?") &&
          !href.includes("letra")
        ) {
          const parts = href.split("cifraclub.com.br/")[1];
          if (!parts) continue;

          const segments = parts.split("/").filter(Boolean);
          if (segments.length === 2) return href;
        }
      }

      return null;
    });

    if (!link) {
      await browser.close();
      return null;
    }

    await page.goto(link, { waitUntil: "domcontentloaded" });

    await page.waitForSelector(".cifra_cnt, pre, #js-tab-content");

    const cifra = await page.evaluate(() => {
      const el =
        document.querySelector(".cifra_cnt") ||
        document.querySelector("pre") ||
        document.querySelector("#js-tab-content");

      return el ? el.innerText.trim() : null;
    });

    await browser.close();

    setCache(cacheKey, cifra);

    return cifra;
  } catch (e) {
    await browser.close();
    return null;
  }
}

/// 🔎 SEARCH
app.get("/search-music", async (req, res) => {
  try {
    const query = normalize(req.query.q || "");

    if (!query) return res.json([]);

    const cacheKey = `search-${query}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const deezer = await axios.get(
      `https://api.deezer.com/search?q=${encodeURIComponent(query)}`
    );

    const results = deezer.data.data.slice(0, 10).map((item) => ({
      title: item.title,
      artist: item.artist.name,
      cover: item.album.cover_medium,
      preview: item.preview,

      cifraUrl: `https://www.cifraclub.com.br/${slug(
        item.artist.name
      )}/${slug(item.title)}/`,

      letraUrl: `https://www.letras.mus.br/${slug(
        item.artist.name
      )}/${slug(item.title)}/`,
    }));

    setCache(cacheKey, results);

    res.json(results);
  } catch (e) {
    res.json([]);
  }
});

/// 🎸 FULL
app.get("/music-full", async (req, res) => {
  try {
    const title = normalize(req.query.title || "");
    const artist = normalize(req.query.artist || "");

    const cacheKey = `full-${title}-${artist}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const cifra = await buscarCifraCifraClub(title, artist);

    const result = {
      title,
      artist,
      cifra,
      cifraUrl: `https://www.cifraclub.com.br/${slug(
        artist
      )}/${slug(title)}/`,
      letraUrl: `https://www.letras.mus.br/${slug(
        artist
      )}/${slug(title)}/`,
    };

    setCache(cacheKey, result);

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("API Louvor rodando 🚀");
});

app.listen(PORT, () => {
  console.log("🔥 API rodando na porta " + PORT);
});