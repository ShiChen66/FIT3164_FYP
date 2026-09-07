const TITLE_SELECTORS = [
  "shreddit-post",
  "a[slot='title']",
  "h3",
  "p.title > a"
];

const MAX_POSTS = 10;

function readTitles() {
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

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "getTitles") {
    sendResponse({ titles: readTitles() });
  }
});
