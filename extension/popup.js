const API_URL = "http://127.0.0.1:8000/analyse";
const AUTO_UPDATE_DEBOUNCE_MS = 1000;

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

function renderSentimentBreakdown(commentResults) {
  const counts = { negative: 0, neutral: 0, positive: 0 };
  for (const result of commentResults) {
    if (counts.hasOwnProperty(result.sentiment_label)) {
      counts[result.sentiment_label]++;
    }
  }
  const total = commentResults.length;

  const container = document.createElement("li");
  container.className = "sentiment-breakdown";

  const label = document.createElement("div");
  label.className = "sentiment-breakdown-label";
  label.textContent = "Comment sentiment breakdown";
  container.appendChild(label);

  for (const key of ["negative", "neutral", "positive"]) {
    const percent = total > 0 ? Math.round((counts[key] / total) * 100) : 0;

    const row = document.createElement("div");
    row.className = "sentiment-breakdown-row";

    const rowLabel = document.createElement("span");
    rowLabel.className = "sentiment-breakdown-row-label";
    rowLabel.textContent = key;
    row.appendChild(rowLabel);

    const track = document.createElement("div");
    track.className = "sentiment-breakdown-track";
    const fill = document.createElement("div");
    fill.className = "sentiment-breakdown-fill " + key;
    fill.style.width = percent + "%";
    track.appendChild(fill);
    row.appendChild(track);

    const percentLabel = document.createElement("span");
    percentLabel.className = "sentiment-breakdown-percent";
    percentLabel.textContent = percent + "%";
    row.appendChild(percentLabel);
 
    container.appendChild(row);
  }
 
  return container;
}

function renderPost(postResult, commentResults) {
  resultsEl.textContent = "";

  resultsEl.appendChild(makeHeading("Post"));
  resultsEl.appendChild(renderResultItem(postResult));

  if (commentResults.length > 0) {
    resultsEl.appendChild(renderSentimentBreakdown(commentResults));
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

  const startTime = performance.now();

  callApi(titles)
    .then(function (data) {
      const timeMessage = showAnalysisTime(startTime);

      statusEl.textContent =
        "Checked " + data.results.length + " posts. " + timeMessage;

      renderListing(data.results);
    })
    .catch(handleApiError);
}

function analysePost(post, comments) {
  const postText = (post.title + " " + (post.body || "")).trim();
  const allTexts = [postText].concat(comments);

  statusEl.textContent =
    "Analysing post and " + comments.length + " comments...";

  const startTime = performance.now();

  callApi(allTexts)
    .then(function (data) {
      const postResult = data.results[0];
      const commentResults = data.results.slice(1);
      const timeMessage = showAnalysisTime(startTime);

      statusEl.textContent =
        "Checked post and " +
        commentResults.length +
        " comments. " +
        timeMessage;

      renderPost(postResult, commentResults);
    })
    .catch(handleApiError);
}

function showAnalysisTime(startTime) {
  const endTime = performance.now();
  const elapsedSeconds = ((endTime - startTime) / 1000).toFixed(2);

  if (elapsedSeconds <= 10) {
    return "Completed in " + elapsedSeconds + "s ✓";
  } else {
    return "Completed in " + elapsedSeconds + "s - exceeded 10s";
  }
}

function handleContent(content) {
  if (content.type === "post") {
    if (!content.post.title) {
      statusEl.textContent = "Could not read this post.";
      return;
    }
    analysePost(content.post, content.comments);
  } else {
    if (content.titles.length === 0) {
      statusEl.textContent = "No posts found on this page.";
      return;
    }
    analyseListing(content.titles);
  }
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
      handleContent(response);
    });
  });
}

let autoUpdateTimer = null;

chrome.runtime.onMessage.addListener(function (message) {
  if (message.type !== "pageContentUpdated") return;

  clearTimeout(autoUpdateTimer);
  autoUpdateTimer = setTimeout(function () {
    handleContent(message.payload);
  }, AUTO_UPDATE_DEBOUNCE_MS);
});

document.getElementById("rerun").addEventListener("click", run);
run();