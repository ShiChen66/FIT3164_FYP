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