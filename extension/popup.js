/* ============================================================
   Reddit Checker - side panel UI
   Presentation layer only. The API contract is unchanged:
     POST /analyse { texts: [...] }
       -> { results: [{ text, misinformation_label,
                        misinformation_confidence, sentiment_label }] }
   All page text is written with textContent, never innerHTML,
   so scraped Reddit content can never inject markup.
   ============================================================ */

const API_URL = "http://127.0.0.1:8000/analyse";
const HEALTH_URL = "http://127.0.0.1:8000/health";
const AUTO_UPDATE_DEBOUNCE_MS = 1000;
const SLOW_THRESHOLD_S = 10;          // requirement r7
const RECENT_KEY = "rc.recent";
const THEME_KEY = "rc.theme";
const RECENT_MAX = 4;

const mainEl = document.getElementById("main");
const footEl = document.getElementById("foot");
const connDot = document.getElementById("conn-dot");
const connText = document.getElementById("conn-text");
const ctxTitle = document.getElementById("ctx-title");
const ctxSub = document.getElementById("ctx-sub");

/* ---------------- tiny DOM helpers ---------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function icon(id, className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (className) svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#" + id);
  svg.appendChild(use);
  return svg;
}

function append(parent, children) {
  for (const child of children) {
    if (child) parent.appendChild(child);
  }
  return parent;
}

function clear(node) {
  node.textContent = "";
}

/* ---------------- theme ---------------- */

function readTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
  if (stored === "light" || stored === "dark") return stored;
  return "dark";   // dark is the product default; the header toggle switches and remembers
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const next = theme === "dark" ? "light" : "dark";
  const toggle = document.getElementById("theme-toggle");
  toggle.setAttribute("aria-label", "Switch to " + next + " mode");
  toggle.title = "Switch to " + next + " mode";
  clear(toggle);
  toggle.appendChild(icon(theme === "dark" ? "i-sun" : "i-moon"));
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
  applyTheme(next);
}

/* ---------------- state ---------------- */

const state = {
  view: "home",            // home | scanning | listing | post | offline
  online: null,            // null = unknown, true, false
  elapsed: null,           // seconds, last completed scan
  scanLabel: "",
  context: { title: "Reddit Checker", sub: "misinformation & sentiment" },
  listing: { results: [], filter: "all" },
  post: { post: null, comments: [], tab: "post", filter: "all", sort: "page" },
  lastError: ""
};

let timerHandle = null;
let timerStart = 0;

/* ---------------- formatting ---------------- */

const SENTIMENT = {
  negative: { glyph: "▼", word: "Negative", cls: "neg" },
  neutral:  { glyph: "■", word: "Neutral",  cls: "neu" },
  positive: { glyph: "▲", word: "Positive", cls: "pos" }
};

function sentimentOf(result) {
  return SENTIMENT[result.sentiment_label] || SENTIMENT.neutral;
}

function isMisleading(result) {
  return result.misinformation_label === "misleading";
}

function confidenceOf(result) {
  return Math.round((result.misinformation_confidence || 0) * 100);
}

function confidenceBand(percent) {
  if (percent >= 85) return "Strong signal from the model, though it is still a prediction, not a fact-check.";
  if (percent >= 70) return "Fairly strong signal, but not proof. Check the source before you share this.";
  if (percent >= 60) return "Weak signal. Treat this as unclear rather than decided.";
  return "The model is close to a coin flip here. Read it yourself before drawing any conclusion.";
}

function relativeTime(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + " hr ago";
  return Math.round(hours / 24) + " d ago";
}

/* ---------------- recent scans (localStorage, no new permission) ---------------- */

function readRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function pushRecent(entry) {
  try {
    const list = readRecent().filter(function (item) { return item.label !== entry.label; });
    list.unshift(entry);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch (e) { /* private mode - recent list is a nicety, not a feature */ }
}

/* ---------------- components ---------------- */

function verdictTag(result, compact) {
  const bad = isMisleading(result);
  const tag = el("span", "tag " + (bad ? "risk" : "safe"));
  tag.appendChild(icon(bad ? "i-warn" : "i-shield"));
  tag.appendChild(document.createTextNode(
    bad ? (compact ? "Misleading" : "Possibly misleading") : "No flags"
  ));
  tag.appendChild(el("span", "pc", confidenceOf(result) + "%"));
  return tag;
}

function sentimentTag(result) {
  const mood = sentimentOf(result);
  const tag = el("span", "tag neu");
  tag.appendChild(el("span", "gly " + mood.cls, mood.glyph));
  tag.appendChild(document.createTextNode(mood.word));
  return tag;
}

function kicker(text, muted) {
  return el("p", "kicker" + (muted ? " mute" : ""), text);
}

function chip(label, count, active, onClick, iconId) {
  const button = el("button", "chip" + (active ? " on" : ""));
  button.type = "button";
  button.setAttribute("aria-pressed", active ? "true" : "false");
  if (iconId) button.appendChild(icon(iconId));
  button.appendChild(document.createTextNode(label));
  if (count !== null && count !== undefined) button.appendChild(el("span", "n", String(count)));
  button.addEventListener("click", onClick);
  return button;
}

function actionButton(label, iconId, variant, onClick) {
  const button = el("button", "btn " + variant);
  button.type = "button";
  if (iconId) button.appendChild(icon(iconId));
  button.appendChild(el("span", null, label));
  button.addEventListener("click", onClick);
  return button;
}

function moodBlock(commentResults) {
  const counts = { negative: 0, neutral: 0, positive: 0 };
  for (const result of commentResults) {
    if (Object.prototype.hasOwnProperty.call(counts, result.sentiment_label)) {
      counts[result.sentiment_label]++;
    }
  }
  const total = commentResults.length || 1;
  const order = ["negative", "neutral", "positive"];

  const wrap = document.createDocumentFragment();
  wrap.appendChild(kicker("Discussion mood — " + commentResults.length + " comments", true));

  const stack = el("div", "stack");
  stack.setAttribute("role", "img");
  stack.setAttribute("aria-label", order.map(function (key) {
    return counts[key] + " " + key;
  }).join(", "));
  for (const key of order) {
    const percent = Math.round((counts[key] / total) * 100);
    if (percent === 0) continue;
    const seg = el("div", "seg " + SENTIMENT[key].cls);
    seg.style.width = percent + "%";
    if (percent >= 12) seg.appendChild(el("span", null, percent + "%"));
    stack.appendChild(seg);
  }
  wrap.appendChild(stack);

  const legend = el("div", "legend");
  for (const key of order) {
    const item = el("div", "lg");
    item.appendChild(el("span", "gly " + SENTIMENT[key].cls, SENTIMENT[key].glyph));
    const text = el("div");
    text.appendChild(el("div", "lv", String(counts[key])));
    text.appendChild(el("div", "lk", SENTIMENT[key].word));
    item.appendChild(text);
    legend.appendChild(item);
  }
  wrap.appendChild(legend);

  const flagged = commentResults.filter(isMisleading).length;
  const dominant = order.reduce(function (a, b) { return counts[a] >= counts[b] ? a : b; });
  const summary = el("div", "card tight note");
  summary.appendChild(document.createTextNode("Mostly "));
  summary.appendChild(el("strong", null, dominant));
  summary.appendChild(document.createTextNode(
    " — " + counts[dominant] + " of " + commentResults.length + " comments. "
  ));
  summary.appendChild(el("strong", null, flagged === 0 ? "No comments" : (flagged + (flagged === 1 ? " comment" : " comments"))));
  summary.appendChild(document.createTextNode(
    flagged === 0 ? " were flagged as misleading." : " also flagged as misleading."
  ));
  summary.style.marginTop = "9px";
  wrap.appendChild(summary);

  return wrap;
}

function commentRow(result) {
  const mood = sentimentOf(result);
  const row = el("div", "crow");
  row.appendChild(el("div", "crail " + mood.cls));
  const body = el("div", "cbody");
  const head = el("div", "chead");
  head.appendChild(verdictTag(result, true));
  head.appendChild(sentimentTag(result));
  body.appendChild(head);
  const text = el("div", "ctext", result.text);
  text.tabIndex = 0;
  text.addEventListener("click", function () { text.classList.toggle("open"); });
  body.appendChild(text);
  row.appendChild(body);
  return row;
}

/* ---------------- views ---------------- */

function renderHome() {
  const recent = readRecent();

  mainEl.appendChild(kicker(state.online === false ? "Offline" : "Ready"));
  const hero = el("h1", "hero");
  hero.appendChild(document.createTextNode("Know what you’re"));
  hero.appendChild(el("br"));
  hero.appendChild(document.createTextNode("reading, before"));
  hero.appendChild(el("br"));
  hero.appendChild(document.createTextNode("you believe it."));
  mainEl.appendChild(hero);
  mainEl.appendChild(el("p", "lede",
    "Open any Reddit page. This panel reads the post and its comments, flags claims that look misleading, and shows how the thread actually feels."));

  mainEl.appendChild(redditButton(function () {
    if (window.chrome && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: "https://www.reddit.com/" });
    }
  }));

  const perf = kicker("Model performance", true);
  perf.style.margin = "17px 0 8px";
  mainEl.appendChild(perf);

  const stats = el("div", "stats");
  stats.appendChild(statTile("86.1%", "Misinformation\ntest accuracy"));
  stats.appendChild(statTile("76.2%", "Sentiment\ntest accuracy"));
  mainEl.appendChild(stats);

  mainEl.appendChild(kicker("How it works", true));
  const steps = el("div", "card");
  steps.style.padding = "11px 13px";
  const lines = [
    "Open a subreddit or a post — the panel follows the tab.",
    "Titles and visible comments are read from the page.",
    "Each one gets a verdict, a confidence score and a mood."
  ];
  lines.forEach(function (line, index) {
    const step = el("div", "step");
    step.appendChild(el("div", "i", String(index + 1)));
    step.appendChild(el("div", "t", line));
    steps.appendChild(step);
  });
  mainEl.appendChild(steps);

  if (recent.length > 0) {
    const recentKicker = kicker("Recent", true);
    recentKicker.style.margin = "17px 0 8px";
    mainEl.appendChild(recentKicker);
    const card = el("div", "card");
    card.style.padding = "4px 13px 9px";
    for (const entry of recent) {
      const row = el("div", "rrow");
      const text = el("div");
      text.appendChild(el("div", "sub", entry.label));
      text.appendChild(el("div", "meta", entry.meta));
      row.appendChild(text);
      row.appendChild(el("div", "ago", relativeTime(entry.at)));
      card.appendChild(row);
    }
    mainEl.appendChild(card);
  }
}

function redditButton(onClick) {
  const button = el("button", "btn btn-pri");
  button.type = "button";
  const chip = el("span", "btn-mark");
  const body = icon("i-reddit", "solid m1");
  body.setAttribute("viewBox", "0 0 32 32");
  const face = icon("i-reddit-face", "solid m2");
  face.setAttribute("viewBox", "0 0 32 32");
  chip.appendChild(body);
  chip.appendChild(face);
  button.appendChild(chip);
  button.appendChild(el("span", null, "Open Reddit"));
  button.appendChild(icon("i-arrow"));
  button.addEventListener("click", onClick);
  return button;
}

function statTile(value, caption) {
  const tile = el("div", "stat");
  tile.appendChild(el("div", "v", value));
  const k = el("div", "k");
  caption.split("\n").forEach(function (line, index) {
    if (index > 0) k.appendChild(el("br"));
    k.appendChild(document.createTextNode(line));
  });
  tile.appendChild(k);
  return tile;
}

function renderScanning() {
  mainEl.setAttribute("aria-busy", "true");
  mainEl.appendChild(kicker("Analysing"));
  const hero = el("h1", "hero", state.scanLabel);
  hero.style.fontSize = "17px";
  hero.style.marginBottom = "12px";
  mainEl.appendChild(hero);

  const prog = el("div", "prog");
  prog.appendChild(el("i"));
  mainEl.appendChild(prog);

  for (let i = 0; i < 4; i++) {
    const card = el("div", "card");
    card.style.opacity = String(1 - i * 0.22);
    card.appendChild(el("div", "sk " + (i % 2 ? "w70" : "w90")));
    card.appendChild(el("div", "sk " + (i % 2 ? "w45" : "w70")));
    card.appendChild(el("div", "sk pill"));
    mainEl.appendChild(card);
  }

  const note = el("p", "center", "Target is under " + SLOW_THRESHOLD_S + " seconds");
  note.style.fontSize = "11px";
  note.style.color = "var(--ink-3)";
  note.style.marginTop = "16px";
  mainEl.appendChild(note);
}

function renderListing() {
  const all = state.listing.results;
  const flagged = all.filter(isMisleading);
  const clean = all.filter(function (r) { return !isMisleading(r); });

  const strip = el("div", "sumstrip");
  strip.appendChild(sumCell(String(all.length), "Scanned", false));
  strip.appendChild(sumCell(String(flagged.length), "Flagged", flagged.length > 0));
  strip.appendChild(sumCell(String(clean.length), "Clean", false));
  mainEl.appendChild(strip);

  const chips = el("div", "chips");
  const setFilter = function (value) {
    return function () { state.listing.filter = value; render(); };
  };
  chips.appendChild(chip("All", all.length, state.listing.filter === "all", setFilter("all")));
  chips.appendChild(chip("Flagged", flagged.length, state.listing.filter === "flagged", setFilter("flagged")));
  chips.appendChild(chip("Clean", clean.length, state.listing.filter === "clean", setFilter("clean")));
  const rescan = el("button", "icbtn push");
  rescan.type = "button";
  rescan.setAttribute("aria-label", "Re-scan this page");
  rescan.appendChild(icon("i-ref"));
  rescan.addEventListener("click", run);
  chips.appendChild(rescan);
  mainEl.appendChild(chips);

  const shown = state.listing.filter === "flagged" ? flagged
    : state.listing.filter === "clean" ? clean : all;

  if (shown.length === 0) {
    mainEl.appendChild(emptyBlock("Nothing in this filter",
      "No posts on this page matched. Switch the filter above to see the rest."));
    return;
  }

  shown.forEach(function (result, index) {
    const row = el("div", "prow" + (isMisleading(result) ? " flagged" : ""));
    row.appendChild(el("div", "idx", String(index + 1).padStart(2, "0")));
    const body = el("div", "body");
    body.appendChild(el("div", "ttl", result.text));
    const tags = el("div", "tags");
    tags.appendChild(verdictTag(result, false));
    tags.appendChild(sentimentTag(result));
    body.appendChild(tags);
    row.appendChild(body);
    mainEl.appendChild(row);
  });
}

function sumCell(value, caption, isRisk) {
  const cell = el("div", "sumcell");
  cell.appendChild(el("div", "v" + (isRisk ? " risk" : ""), value));
  cell.appendChild(el("div", "k", caption));
  return cell;
}

function renderPost() {
  const postResult = state.post.post;
  const comments = state.post.comments;
  const bad = isMisleading(postResult);
  const percent = confidenceOf(postResult);

  if (state.post.tab === "post") {
    const card = el("div", "card");
    card.style.padding = "14px";

    const verdict = el("div", "verdict");
    const vicon = el("div", "vicon " + (bad ? "risk" : "safe"));
    vicon.appendChild(icon(bad ? "i-warn" : "i-shield"));
    verdict.appendChild(vicon);
    const labels = el("div");
    labels.style.minWidth = "0";
    labels.appendChild(el("div", "vlabel " + (bad ? "risk" : "safe"),
      bad ? "Possibly misleading" : "No flags found"));
    labels.appendChild(el("div", "vsub", "Checked against the title and body text"));
    verdict.appendChild(labels);
    card.appendChild(verdict);

    const meter = el("div", "meter");
    const track = el("div", "mtrack");
    const fill = el("div", "mfill " + (bad ? "risk" : "safe"));
    fill.style.width = percent + "%";
    track.appendChild(fill);
    meter.appendChild(track);
    const ticks = el("div", "mticks");
    ticks.appendChild(el("span", null, "0%"));
    ticks.appendChild(el("span", null, "50% · unsure"));
    ticks.appendChild(el("span", null, "100%"));
    meter.appendChild(ticks);
    card.appendChild(meter);

    const readout = el("div", "readout");
    readout.appendChild(el("strong", null, percent + "% confidence."));
    readout.appendChild(document.createTextNode(" " + confidenceBand(percent)));
    card.appendChild(readout);

    card.appendChild(el("div", "posttitle", "“" + postResult.text + "”"));
    mainEl.appendChild(card);

    if (comments.length > 0) {
      const mood = moodBlock(comments);
      mainEl.appendChild(mood);
    }
  }

  const readKicker = kicker("Read", true);
  readKicker.style.margin = "17px 0 8px";
  mainEl.appendChild(readKicker);
  mainEl.appendChild(tabs(comments.length));

  if (state.post.tab === "comments") {
    renderComments(comments);
  } else if (comments.length > 0) {
    const flagged = comments.filter(isMisleading);
    if (flagged.length > 0) {
      mainEl.appendChild(kicker("Flagged in this thread — " + flagged.length, true));
      mainEl.appendChild(commentRow(flagged[0]));
    }
    mainEl.appendChild(actionButton(
      "See all " + comments.length + " comments", null, "btn-ghost btn-sm",
      function () { state.post.tab = "comments"; render(); }
    ));
    mainEl.lastChild.style.marginTop = "10px";
  }
}

function tabs(commentCount) {
  const group = el("div", "seg-ctl");
  group.setAttribute("role", "tablist");
  const make = function (key, label, count) {
    const button = el("button", state.post.tab === key ? "on" : "");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", state.post.tab === key ? "true" : "false");
    button.appendChild(document.createTextNode(label));
    if (count !== null) button.appendChild(el("span", "n", String(count)));
    button.addEventListener("click", function () { state.post.tab = key; render(); });
    return button;
  };
  group.appendChild(make("post", "Post", null));
  group.appendChild(make("comments", "Comments", commentCount));
  return group;
}

function renderComments(comments) {
  const flagged = comments.filter(isMisleading);

  const chips = el("div", "chips");
  chips.appendChild(chip("All", comments.length, state.post.filter === "all", function () {
    state.post.filter = "all"; render();
  }));
  chips.appendChild(chip("Flagged", flagged.length, state.post.filter === "flagged", function () {
    state.post.filter = "flagged"; render();
  }));
  const sortLabel = state.post.sort === "negative" ? "Most negative" : "Page order";
  chips.appendChild(chip(sortLabel, null, state.post.sort === "negative", function () {
    state.post.sort = state.post.sort === "negative" ? "page" : "negative";
    render();
  }, "i-sort"));
  mainEl.appendChild(chips);

  let shown = state.post.filter === "flagged" ? flagged : comments.slice();
  if (state.post.sort === "negative") {
    const rank = { negative: 0, neutral: 1, positive: 2 };
    shown.sort(function (a, b) {
      const byMood = (rank[a.sentiment_label] ?? 1) - (rank[b.sentiment_label] ?? 1);
      if (byMood !== 0) return byMood;
      return confidenceOf(b) - confidenceOf(a);
    });
  }

  if (shown.length === 0) {
    mainEl.appendChild(emptyBlock("No flagged comments",
      "Nothing in this thread tripped the misinformation model. Switch back to All to read everything."));
    return;
  }

  for (const result of shown) {
    mainEl.appendChild(commentRow(result));
  }
}

function emptyBlock(title, body) {
  const wrap = el("div");
  wrap.style.paddingTop = "18px";
  const big = el("div", "bigicon calm");
  big.appendChild(icon("i-search"));
  wrap.appendChild(big);
  const heading = el("h1", "hero");
  heading.style.fontSize = "17px";
  heading.textContent = title;
  wrap.appendChild(heading);
  wrap.appendChild(el("p", "lede", body));
  return wrap;
}

function renderOffline() {
  const big = el("div", "bigicon");
  big.appendChild(icon("i-plug"));
  mainEl.appendChild(big);

  const hero = el("h1", "hero");
  hero.style.fontSize = "19px";
  hero.appendChild(document.createTextNode("The model server"));
  hero.appendChild(el("br"));
  hero.appendChild(document.createTextNode("isn’t running."));
  mainEl.appendChild(hero);

  mainEl.appendChild(el("p", "lede",
    "Nothing can be analysed until the local API is up. Start it in a terminal from the project folder:"));

  const code = el("pre", "code");
  code.appendChild(document.createTextNode("cd api\n"));
  code.appendChild(el("b", null, "uvicorn"));
  code.appendChild(document.createTextNode(" server:app --port 8000"));
  mainEl.appendChild(code);

  const retry = actionButton("Try again", "i-ref", "btn-pri", run);
  retry.style.marginTop = "13px";
  mainEl.appendChild(retry);

  const card = el("div", "card tight");
  card.style.marginTop = "13px";
  const row1 = el("div", "kv");
  row1.appendChild(el("span", null, "Expecting"));
  row1.appendChild(el("span", "mono", "127.0.0.1:8000"));
  card.appendChild(row1);
  if (state.lastError) {
    const row2 = el("div", "kv");
    row2.appendChild(el("span", null, "Last error"));
    row2.appendChild(el("span", null, state.lastError));
    card.appendChild(row2);
  }
  mainEl.appendChild(card);
}

/* ---------------- footer ---------------- */

function renderFooter() {
  if (state.view === "home" || state.view === "offline") return;

  if (state.view === "scanning") {
    const meta = el("div", "t");
    meta.appendChild(el("span", null, "Elapsed " + currentElapsed() + "s"));
    meta.appendChild(el("span", null, state.scanLabel));
    footEl.appendChild(meta);
    return;
  }

  const meta = el("div", "t");
  const slow = state.elapsed !== null && state.elapsed > SLOW_THRESHOLD_S;
  // r7 is stated as a pass or a fail in words, not only as a colour
  const timing = el("span", slow ? "slow" : null,
    state.elapsed === null ? ""
      : slow ? "Analysed in " + state.elapsed.toFixed(2) + "s \u2014 exceeded " + SLOW_THRESHOLD_S + "s"
             : "Analysed in " + state.elapsed.toFixed(2) + "s \u2713");
  meta.appendChild(timing);
  const count = state.view === "listing"
    ? state.listing.results.length + " posts"
    : state.post.comments.length + " comments";
  meta.appendChild(el("span", null, count));
  footEl.appendChild(meta);

  const row = el("div", "btnrow");
  row.appendChild(actionButton("Re-scan", "i-ref", "btn-pri", run));
  const copy = el("button", "btn btn-ghost");
  copy.type = "button";
  copy.style.width = "auto";
  copy.style.padding = "0 13px";
  copy.setAttribute("aria-label", "Copy a plain-text summary");
  copy.appendChild(icon("i-copy"));
  copy.addEventListener("click", copySummary);
  row.appendChild(copy);
  footEl.appendChild(row);
}

function copySummary() {
  const lines = [];
  if (state.view === "listing") {
    const flagged = state.listing.results.filter(isMisleading).length;
    lines.push("Reddit Checker - " + state.context.title);
    lines.push(state.listing.results.length + " posts scanned, " + flagged + " flagged");
    lines.push("");
    state.listing.results.forEach(function (r, i) {
      lines.push((i + 1) + ". [" + (isMisleading(r) ? "MISLEADING " + confidenceOf(r) + "%" : "no flags")
        + " / " + r.sentiment_label + "] " + r.text);
    });
  } else if (state.view === "post" && state.post.post) {
    const p = state.post.post;
    lines.push("Reddit Checker - " + state.context.title);
    lines.push("Post: " + p.text);
    lines.push("Verdict: " + (isMisleading(p) ? "possibly misleading" : "no flags")
      + " (" + confidenceOf(p) + "% confidence)");
    const counts = { negative: 0, neutral: 0, positive: 0 };
    state.post.comments.forEach(function (c) {
      if (Object.prototype.hasOwnProperty.call(counts, c.sentiment_label)) counts[c.sentiment_label]++;
    });
    lines.push("Comments: " + state.post.comments.length
      + " (" + counts.negative + " negative, " + counts.neutral + " neutral, " + counts.positive + " positive)");
    lines.push("Flagged comments: " + state.post.comments.filter(isMisleading).length);
  }
  if (state.elapsed !== null) {
    lines.push("Analysed in " + state.elapsed.toFixed(2) + "s"
      + (state.elapsed > SLOW_THRESHOLD_S ? " - exceeded " + SLOW_THRESHOLD_S + "s" : " - within " + SLOW_THRESHOLD_S + "s"));
  }

  navigator.clipboard.writeText(lines.join("\n")).then(function () {
    connText.textContent = "Copied";
    setTimeout(checkHealth, 1400);
  }).catch(function () { /* clipboard blocked - nothing to recover */ });
}

/* ---------------- render ---------------- */

function render() {
  clear(mainEl);
  clear(footEl);
  mainEl.setAttribute("aria-busy", "false");
  mainEl.scrollTop = 0;

  ctxTitle.textContent = state.context.title;
  ctxSub.textContent = state.context.sub;

  if (state.view === "home") renderHome();
  else if (state.view === "scanning") renderScanning();
  else if (state.view === "listing") renderListing();
  else if (state.view === "post" && state.post.post) renderPost();
  else renderOffline();

  renderFooter();
}

/* ---------------- timing ---------------- */

function startTimer() {
  timerStart = performance.now();
  clearInterval(timerHandle);
  timerHandle = setInterval(function () {
    if (state.view !== "scanning") return;
    const label = footEl.querySelector(".t span");
    if (label) label.textContent = "Elapsed " + currentElapsed() + "s";
  }, 100);
}

function currentElapsed() {
  return ((performance.now() - timerStart) / 1000).toFixed(1);
}

function stopTimer() {
  clearInterval(timerHandle);
  timerHandle = null;
  state.elapsed = (performance.now() - timerStart) / 1000;
}

/* ---------------- connection ---------------- */

function setConnection(online) {
  state.online = online;
  connDot.className = "dot " + (online === null ? "wait" : online ? "" : "off");
  connText.textContent = online === null ? "Checking…" : online ? "Model online" : "Offline";
}

function checkHealth() {
  return fetch(HEALTH_URL)
    .then(function (response) { setConnection(response.ok); return response.ok; })
    .catch(function () { setConnection(false); return false; });
}

/* ---------------- data flow (contract unchanged) ---------------- */

function callApi(texts) {
  return fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: texts })
  }).then(function (response) {
    if (!response.ok) throw new Error("Server returned " + response.status);
    return response.json();
  });
}

function handleApiError(error) {
  stopTimer();
  state.lastError = String(error && error.message ? error.message : error);
  state.view = "offline";
  setConnection(false);
  render();
  console.error(error);
}

function analyseListing(titles) {
  state.view = "scanning";
  state.scanLabel = "Checking " + titles.length + " post titles…";
  render();
  startTimer();

  callApi(titles)
    .then(function (data) {
      stopTimer();
      setConnection(true);
      state.listing.results = data.results;
      state.listing.filter = "all";
      state.view = "listing";
      const flagged = data.results.filter(isMisleading).length;
      pushRecent({
        label: state.context.title,
        meta: data.results.length + " posts · " + (flagged === 0 ? "clean" : flagged + " flagged"),
        at: Date.now()
      });
      render();
    })
    .catch(handleApiError);
}

function analysePost(post, comments) {
  const postText = (post.title + " " + (post.body || "")).trim();
  const allTexts = [postText].concat(comments);

  state.view = "scanning";
  state.scanLabel = "Checking 1 post and " + comments.length + " comments…";
  render();
  startTimer();

  callApi(allTexts)
    .then(function (data) {
      stopTimer();
      setConnection(true);
      state.post.post = data.results[0];
      state.post.comments = data.results.slice(1);
      state.post.tab = "post";
      state.post.filter = "all";
      state.post.sort = "page";
      state.view = "post";
      const flagged = state.post.comments.filter(isMisleading).length;
      pushRecent({
        label: state.context.title,
        meta: state.post.comments.length + " comments · " + (flagged === 0 ? "clean" : flagged + " flagged"),
        at: Date.now()
      });
      render();
    })
    .catch(handleApiError);
}

function handleContent(content) {
  if (content.type === "post") {
    if (!content.post.title) {
      state.view = "home";
      render();
      return;
    }
    state.context.sub = "post · " + content.comments.length + " comments read";
    analysePost(content.post, content.comments);
  } else {
    if (content.titles.length === 0) {
      state.view = "home";
      render();
      return;
    }
    state.context.sub = "listing · " + content.titles.length + " posts on screen";
    analyseListing(content.titles);
  }
}

function contextFromTab(tab) {
  const url = (tab && tab.url) || "";
  const match = url.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/);
  if (match) return "r/" + match[1];
  if (/reddit\.com/.test(url)) return "Reddit";
  return "Reddit Checker";
}

function run() {
  checkHealth();

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs.length === 0) {
      state.view = "home";
      render();
      return;
    }
    state.context.title = contextFromTab(tabs[0]);

    chrome.tabs.sendMessage(tabs[0].id, { type: "getContent" }, function (response) {
      if (chrome.runtime.lastError || !response) {
        // Not a Reddit page (or the content script has not loaded) - this is the home view.
        state.context.title = "Reddit Checker";
        state.context.sub = "misinformation & sentiment";
        state.view = "home";
        render();
        return;
      }
      handleContent(response);
    });
  });
}

/* ---------------- wiring ---------------- */

let autoUpdateTimer = null;

chrome.runtime.onMessage.addListener(function (message) {
  if (message.type !== "pageContentUpdated") return;
  clearTimeout(autoUpdateTimer);
  autoUpdateTimer = setTimeout(function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs.length > 0) state.context.title = contextFromTab(tabs[0]);
      handleContent(message.payload);
    });
  }, AUTO_UPDATE_DEBOUNCE_MS);
});

document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

applyTheme(readTheme());
setConnection(null);
render();
run();
