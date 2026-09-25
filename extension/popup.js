const API_URL = "http://127.0.0.1:8000/analyse";
 
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
 
function makeTag(text, className) {
  const span = document.createElement("span");
  span.className = "tag " + className;
  span.textContent = text;
  return span;
}
 
function makeHeading(text) {
  const heading = document.createElement("li");
  heading.style.fontWeight = "bold";
  heading.style.color = "#555";
  heading.textContent = text;
  return heading;
}
 
function renderResultItem(result) {
  const item = document.createElement("li");
 
  const titleEl = document.createElement("span");
  titleEl.className = "title";
  titleEl.textContent = result.text;
  item.appendChild(titleEl);
 
  const misleading = result.misinformation_label === "misleading";
  const percent = Math.round(result.misinformation_confidence * 100);
 
  item.appendChild(makeTag(result.misinformation_label + " " + percent + "%", misleading ? "misleading" : "not-misleading"));
  item.appendChild(makeTag(result.sentiment_label, "sentiment"));
 
  return item;
}
 
function renderListing(results) {
  resultsEl.textContent = "";
  for (const result of results) {
    resultsEl.appendChild(renderResultItem(result));
  }
}
 
function renderPost(postResult, commentResults) {
  resultsEl.textContent = "";
 
  resultsEl.appendChild(makeHeading("Post"));
  resultsEl.appendChild(renderResultItem(postResult));
 
  if (commentResults.length > 0) {
    resultsEl.appendChild(makeHeading("Comments (" + commentResults.length + ")"));
    for (const result of commentResults) {
      resultsEl.appendChild(renderResultItem(result));
    }
  }
}
 
function callApi(texts) {
  return fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: texts })
  }).then(function (response) {
    if (!response.ok) {
      throw new Error("Server returned " + response.status);
    }
    return response.json();
  });
}
 
function handleApiError(error) {
  statusEl.textContent = "Could not reach the model server. Start it with: python api/server.py";
  console.error(error);
}
 
function analyseListing(titles) {
  statusEl.textContent = "Analysing " + titles.length + " posts...";
 
  callApi(titles)
    .then(function (data) {
      statusEl.textContent = "Checked " + data.results.length + " posts.";
      renderListing(data.results);
    })
    .catch(handleApiError);
}
 
function analysePost(post, comments) {
  const postText = (post.title + " " + (post.body || "")).trim();
  const allTexts = [postText].concat(comments);
 
  statusEl.textContent = "Analysing post and " + comments.length + " comments...";
 
  callApi(allTexts)
    .then(function (data) {
      const postResult = data.results[0];
      const commentResults = data.results.slice(1);
      statusEl.textContent = "Checked post and " + commentResults.length + " comments.";
      renderPost(postResult, commentResults);
    })
    .catch(handleApiError);
}
 
function run() {
  resultsEl.textContent = "";
  statusEl.textContent = "Reading page...";
 
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs.length === 0) {
      statusEl.textContent = "No active tab.";
      return;
    }
 
    chrome.tabs.sendMessage(tabs[0].id, { type: "getContent" }, function (response) {
      if (chrome.runtime.lastError || !response) {
        statusEl.textContent = "Open a Reddit page and try again.";
        return;
      }
 
      if (response.type === "post") {
        if (!response.post.title) {
          statusEl.textContent = "Could not read this post.";
          return;
        }
        analysePost(response.post, response.comments);
      } else {
        if (response.titles.length === 0) {
          statusEl.textContent = "No posts found on this page.";
          return;
        }
        analyseListing(response.titles);
      }
    });
  });
}
 
document.getElementById("rerun").addEventListener("click", run);
run();
