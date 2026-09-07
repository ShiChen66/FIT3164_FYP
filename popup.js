const API_URL = "http://127.0.0.1:8000/analyse";

const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

function makeTag(text, className) {
  const span = document.createElement("span");
  span.className = "tag " + className;
  span.textContent = text;
  return span;
}

function render(results) {
  resultsEl.textContent = "";

  for (const result of results) {
    const item = document.createElement("li");

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = result.text;
    item.appendChild(title);

    const misleading = result.misinformation_label === "misleading";
    const percent = Math.round(result.misinformation_confidence * 100);

    item.appendChild(makeTag(result.misinformation_label + " " + percent + "%", misleading ? "misleading" : "not-misleading"));
    item.appendChild(makeTag(result.sentiment_label, "sentiment"));

    resultsEl.appendChild(item);
  }
}

function analyse(titles) {
  statusEl.textContent = "Analysing " + titles.length + " posts...";

  fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: titles })
  })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("Server returned " + response.status);
      }
      return response.json();
    })
    .then(function (data) {
      statusEl.textContent = "Checked " + data.results.length + " posts.";
      render(data.results);
    })
    .catch(function (error) {
      statusEl.textContent = "Could not reach the model server. Start it with: python api/server.py";
      console.error(error);
    });
}

function run() {
  resultsEl.textContent = "";
  statusEl.textContent = "Reading posts...";

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs.length === 0) {
      statusEl.textContent = "No active tab.";
      return;
    }

    chrome.tabs.sendMessage(tabs[0].id, { type: "getTitles" }, function (response) {
      if (chrome.runtime.lastError || !response) {
        statusEl.textContent = "Open a Reddit page and try again.";
        return;
      }

      if (response.titles.length === 0) {
        statusEl.textContent = "No posts found on this page.";
        return;
      }

      analyse(response.titles);
    });
  });
}

document.getElementById("rerun").addEventListener("click", run);
run();
