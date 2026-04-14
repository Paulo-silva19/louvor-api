const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

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

function setCache(key, data, ttl = 1000 * 60 * 60 * 24) {
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

/// 🔥 BUSCAR CIFRA
async function buscarCifraCifraClub(title, artist) {
  const cacheKey = `cifra-${title}-${artist}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const query = `${title} ${artist}`;

    const search = await axios.get(
      `https://www.cifraclub.com.br/?q=${encodeURIComponent(query)}`
    );

    const $ = cheerio.load(search.data);

    let link = null;

    $("a").each((_, el) => {
      const href = $(el).attr("href");

      if (
        href &&
        href.includes("cifraclub.com.br") &&
        !href.includes("?") &&
        !href.includes("letra")
      ) {
        link = href;
        return false;
      }
    });

    if (!link) return null;

    const page = await axios.get(link);
    const $$ = cheerio.load(page.data);

    const cifra =
      $$(".cifra_cnt").text() ||
      $$("pre").text() ||
      $$("#js-tab-content").text();

    const result = cifra ? cifra.trim() : null;

    setCache(cacheKey, result);

    return result;
  } catch (e) {
    return null;
  }
}

/// 🔥 BUSCAR TOM
async function buscarTomCifraClub(url) {
  try {
    const response = await axios.get(url);
    const html = response.data;

    const match = html.match(/Tom:\s*([A-G][#b]?)/);

    return match ? match[1] : "";
  } catch (e) {
    return "";
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

/// 🎸 FULL (AGORA COM TOM 🔥)
app.get("/music-full", async (req, res) => {
  try {
    const title = normalize(req.query.title || "");
    const artist = normalize(req.query.artist || "");

    const cacheKey = `full-${title}-${artist}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const cifraUrl = `https://www.cifraclub.com.br/${slug(
      artist
    )}/${slug(title)}/`;

    const cifra = await buscarCifraCifraClub(title, artist);

    /// 🔥 NOVO
    const tom = await buscarTomCifraClub(cifraUrl);

    const result = {
      title,
      artist,
      cifra,
      tom, // 🔥 AQUI
      cifraUrl,
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