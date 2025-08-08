import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import slugify from "slugify";
import { marked } from "marked";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- CONFIG (edit feeds if you like) ----------------
const FEEDS = {
  "Board Games": [
    "https://boardgamegeek.com/rss/news" // BGG News
  ],
  "Art": [
    "https://www.thisiscolossal.com/feed/" // Colossal art/design
  ],
  "Video Games": [
    "https://feeds.ign.com/ign/games-all",
    "https://www.polygon.com/rss/index.xml"
  ],
  "Technology": [
    "https://feeds.arstechnica.com/arstechnica/index",
    "https://techcrunch.com/feed/"
  ],
  "Fiction Books": [
    "https://www.tor.com/fiction/feed/",
    "https://www.goodreads.com/blog/feed"
  ]
};

const FALLBACK = {
  "Board Games": "assets/images/board-games.svg",
  "Art": "assets/images/art.svg",
  "Video Games": "assets/images/video-games.svg",
  "Technology": "assets/images/technology.svg",
  "Fiction Books": "assets/images/fiction-books.svg"
};

const GEMINI_KEY = process.env.GEMINI_API_KEY; // store as GitHub Secret
const PERSPECTIVE_KEY = process.env.PERSPECTIVE_API_KEY; // store as GitHub Secret

// -----------------------------------------------------------

async function fetchText(url){
  const res = await fetch(url, {headers:{ "User-Agent":"CNC-Daily/1.0" }});
  if(!res.ok) throw new Error(`Fetch failed ${url}: ${res.status}`);
  return res.text();
}

function parseRSS(xml){
  // very light RSS/Atom parsing
  const dom = new JSDOM(xml, {contentType:"text/xml"});
  const doc = dom.window.document;
  const items = Array.from(doc.querySelectorAll("item, entry")).map(el=>{
    const title = el.querySelector("title")?.textContent?.trim() || "Untitled";
    const link = el.querySelector("link")?.getAttribute("href") || el.querySelector("link")?.textContent?.trim() || "";
    const pub = el.querySelector("pubDate, updated, published")?.textContent || "";
    const content = el.querySelector("content\\:encoded, content, summary, description")?.textContent || "";
    const enclosure = el.querySelector("enclosure")?.getAttribute("url") || "";
    // OPENGRAPH img in content (rough)
    const ogImg = (content.match(/<img[^>]+src="([^"]+)"/i) || [])[1] || "";
    return {title, link, pubDate: new Date(pub), snippet: stripTags(content).slice(0,400), image: enclosure || ogImg};
  });
  // newest first
  return items.sort((a,b)=> (b.pubDate - a.pubDate));
}

function stripTags(html){
  return html.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
}

async function extractArticle(url){
  try{
    const html = await fetchText(url);
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return {
      text: article?.textContent?.trim() || "",
      image: (html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1] || ""
    };
  }catch(e){
    return { text:"", image:"" };
  }
}

async function summarizeWithGemini({category, title, url, text}){
  if(!GEMINI_KEY) throw new Error("Missing GEMINI_API_KEY");
  const prompt = `You are a helpful assistant writing short news summaries in a friendly, conversational tone.
Summarize the following article for a general audience in 150-220 words.
- Keep it factual and neutral.
- Avoid speculation, slurs, adult content, or harassment.
- Include a one-sentence takeaway at the end starting with 'Why it matters:'.
Provide only plain paragraphs without lists.

Title: ${title}
URL: ${url}
Article text:
${text.slice(0,8000)}
`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_KEY}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({
      contents:[{ role:"user", parts:[{text: prompt}] }],
      safetySettings:[
        {"category":"HARM_CATEGORY_HATE_SPEECH","threshold":"BLOCK_NONE"},
        {"category":"HARM_CATEGORY_SEXUALLY_EXPLICIT","threshold":"BLOCK_NONE"},
        {"category":"HARM_CATEGORY_HARASSMENT","threshold":"BLOCK_NONE"},
        {"category":"HARM_CATEGORY_DANGEROUS_CONTENT","threshold":"BLOCK_NONE"}
      ]
    })
  });
  if(!res.ok){
    const t = await res.text();
    throw new Error(`Gemini error: ${t}`);
  }
  const data = await res.json();
  const textOut = data.candidates?.[0]?.content?.parts?.map(p=>p.text).join("\n").trim() || "";
  return textOut;
}

async function isSafeWithPerspective(text){
  if(!PERSPECTIVE_KEY) throw new Error("Missing PERSPECTIVE_API_KEY");
  const res = await fetch(`https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${PERSPECTIVE_KEY}`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({
      comment: { text },
      languages:["en"],
      requestedAttributes: {
        TOXICITY:{}, INSULT:{}, THREAT:{}, SEXUALLY_EXPLICIT:{}, PROFANITY:{}
      }
    })
  });
  if(!res.ok){ return false; }
  const d = await res.json();
  const get = k => d.attributeScores?.[k]?.summaryScore?.value || 0;
  const scores = ["TOXICITY","INSULT","THREAT","SEXUALLY_EXPLICIT","PROFANITY"].map(k=>get(k));
  return scores.every(v => v < 0.5); // skip if any >= 0.5
}

function writePost({md, meta, imageLocal}){
  const slug = slugify(meta.title,{lower:true,strict:true}).slice(0,100);
  const date = new Date().toISOString().slice(0,10);
  const fm = [
    "---",
    `title: "${meta.title.replace(/"/g,'\\"')}"`,
    `date: ${date}`,
    `category: ${meta.category}`,
    `image: ${imageLocal}`,
    `source: ${meta.url}`,
    "---",
    ""
  ].join("\n");
  const file = path.join(__dirname, "..", "posts", `${date}-${slug}.md`);
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, fm + md);
  return file;
}

function rebuildHome(){
  const postsDir = path.join(__dirname,"..","posts");
  const files = fs.readdirSync(postsDir).filter(f=>f.endsWith(".md")).sort().reverse().slice(0,50);
  const cards = files.map(f=>{
    const md = fs.readFileSync(path.join(postsDir,f),"utf8");
    const title = /title:\s*"([^"]+)"/.exec(md)?.[1] || "Untitled";
    const date = /date:\s*([0-9-]+)/.exec(md)?.[1] || "";
    const category = /category:\s*([^\n]+)/.exec(md)?.[1] || "";
    const img = /image:\s*([^\n]+)/.exec(md)?.[1] || "";
    const src = /source:\s*([^\n]+)/.exec(md)?.[1] || "#";
    const body = md.split("---\n").slice(2).join("---\n");
    const html = marked.parse(body);
    return `
      <article>
        <img alt="" src="${img}" />
        <div class="pad">
          <div class="meta"><span>${category}</span><span>·</span><span>${date}</span></div>
          <h2><a href="${src}" target="_blank" rel="noopener">${title}</a></h2>
          <div>${html}</div>
        </div>
      </article>`;
  }).join("\n");

  const template = fs.readFileSync(path.join(__dirname,"template.html"),"utf8");
  const out = template.replace("<!-- POSTS_INJECT -->", cards || "<p>No posts yet.</p>");
  const outPath = path.join(__dirname,"..","docs","index.html");
  fs.mkdirSync(path.dirname(outPath), {recursive:true});
  fs.writeFileSync(outPath, out);
}

async function pickLatestFromFeeds(category){
  for(const url of FEEDS[category]){
    try{
      const xml = await fetchText(url);
      const items = parseRSS(xml);
      if(items.length) return items[0];
    }catch(e){ /* try next feed */ }
  }
  return null;
}

async function run(){
  const results = [];
  for(const category of Object.keys(FEEDS)){
    const item = await pickLatestFromFeeds(category);
    if(!item) continue;

    // Try to extract full text + image
    const extracted = await extractArticle(item.link);
    const text = (extracted.text && extracted.text.length > 400) ? extracted.text : (item.snippet || "");
    const image = extracted.image || item.image || FALLBACK[category];

    // Summarize
    let summary = "";
    try{
      summary = await summarizeWithGemini({category, title:item.title, url:item.link, text});
    }catch(e){
      console.error("Gemini summarize failed:", e.message);
      continue;
    }

    // Safety check
    try{
      const safe = await isSafeWithPerspective(summary);
      if(!safe){
        console.log(`Skipped unsafe content for category ${category}`);
        continue;
      }
    }catch(e){
      console.error("Perspective check failed:", e.message);
      continue;
    }

    // Compose Markdown
    const md = `**Original:** [${item.title}](${item.link})

${summary}

*Source: ${item.link}*`;

    writePost({ md, meta:{ title:item.title, category, url:item.link }, imageLocal: image });
    results.push({category, title:item.title});
  }
  rebuildHome();
  console.log("Published posts:", results);
}

run().catch(e=>{ console.error(e); process.exit(1); });
