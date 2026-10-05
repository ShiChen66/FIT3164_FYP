const MAX_POSTS = 10;
const MAX_COMMENTS = 20;

const TITLE_SELECTORS = [
  "shreddit-post",
  "a[slot='title']",
  "h3",
  "p.title > a"
];

function isPostPage() {
  return /\/comments\//.test(window.location.pathname);
}

function readListingTitles() {
  const seen = [];

  for (const selector of TITLE_SELECTORS) {
    const nodes = document.querySelectorAll(selector);

    for (const node of nodes) {
      const title = (node.getAttribute("post-title") || node.innerText || "").trim();

      if (title.length > 10 && !seen.includes(title)) {
        seen.push(title);
      }

      if (seen.length >= MAX_POSTS) {
        return seen;
      }
    }
  }

  return seen;
}

function readSinglePost() {
  const shredditPost = document.querySelector("shreddit-post");

  if (shredditPost) {
    const title = (shredditPost.getAttribute("post-title") || "").trim();
    const body = (shredditPost.querySelector("[slot='text-body']")?.innerText || "").trim();
    if (title) {
      return { title: title, body: body };
    }
  }

  const h1 = document.querySelector("h1");
  return { title: h1 ? h1.innerText.trim() : "", body: "" };
}

function readComments() {
  const comments = [];

  const shredditComments = document.querySelectorAll("shreddit-comment");
  for (const el of shredditComments) {
    const text = (el.querySelector("[slot='comment']")?.innerText || el.innerText || "").trim();
    if (text.length > 0) {
      comments.push(text);
    }
    if (comments.length >= MAX_COMMENTS) {
      return comments;
    }
  }
  if (comments.length > 0) {
    return comments;
  }

  const legacyComments = document.querySelectorAll("div[data-testid='comment'] p");
  for (const el of legacyComments) {
    const text = el.innerText.trim();
    if (text.length > 0) {
      comments.push(text);
    }
    if (comments.length >= MAX_COMMENTS) {
      break;
    }
  }
  return comments;
}

function readPageContent() {
  if (isPostPage()) {
    return {
      type: "post",
      post: readSinglePost(),
      comments: readComments()
    };
  }

  return {
    type: "listing",
    titles: readListingTitles()
  };
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "getContent") {
    sendResponse(readPageContent());
  }
});

function pushCurrentContent() {
  const content = readPageContent();
  console.log("[reddit-checker] pushCurrentContent read:", content);

  if (content.type === "post" && !content.post.title) {
    console.log("[reddit-checker] bailing — post title is empty, page not rendered yet?");
    return;
  }
  if (content.type === "listing" && content.titles.length === 0) {
    console.log("[reddit-checker] bailing — no listing titles found");
    return;
  }

  console.log("[reddit-checker] sending pageContentUpdated");
  chrome.runtime.sendMessage({ type: "pageContentUpdated", payload: content })
    .then(() => console.log("[reddit-checker] message delivered"))
    .catch((err) => console.log("[reddit-checker] no listener (side panel closed?)", err));
}

const STABILITY_WAIT_MS = 800;
const MAX_WAIT_MS = 6000;

let stabilityTimer = null;
let maxWaitTimer = null;
let navigationObserver = null;

function stopWaitingForStableContent() {
  if (navigationObserver) {
    navigationObserver.disconnect();
    navigationObserver = null;
  }
  clearTimeout(stabilityTimer);
  clearTimeout(maxWaitTimer);
  stabilityTimer = null;
  maxWaitTimer = null;
}

function waitForStableContentThenPush() {
  stopWaitingForStableContent();

  const pushAndStop = function () {
    stopWaitingForStableContent();
    pushCurrentContent();
  };

  stabilityTimer = setTimeout(pushAndStop, STABILITY_WAIT_MS);
  maxWaitTimer = setTimeout(pushAndStop, MAX_WAIT_MS);
 
  navigationObserver = new MutationObserver(function () {
    clearTimeout(stabilityTimer);
    stabilityTimer = setTimeout(pushAndStop, STABILITY_WAIT_MS);
  });
  navigationObserver.observe(document.body, { childList: true, subtree: true });
}

let lastUrl = window.location.href;
setInterval(function () {
  if (window.location.href !== lastUrl) {
    console.log("[reddit-checker] URL changed:", lastUrl, "->", window.location.href);
    lastUrl = window.location.href;
    waitForStableContentThenPush();
  }
}, 500);

waitForStableContentThenPush();