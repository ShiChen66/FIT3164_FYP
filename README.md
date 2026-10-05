# Reddit AI Misinformation & Sentiment Checker

A Chrome extension that flags potentially misleading AI-related Reddit posts/comments
and summarises comment sentiment, backed by a FastAPI server running two
fine-tuned RoBERTa models.

## Project structure

```
extension/   Chrome extension (side panel UI, content script, background worker)
api/         FastAPI backend - loads trained models and serves /analyse
ml/          Training scripts, data preprocessing, model architecture
```

## Prerequisites

- **Python 3.10+**
- **Google Chrome** (or another Chromium-based browser with Manifest V3 + Side
  Panel API support)

## 1. Install backend dependencies

```bash
pip install -r api/requirements.txt
```

This installs FastAPI/uvicorn plus `torch`, `transformers`, and `huggingface_hub`,
since the server loads and runs the models directly.

## 2. Start the backend

```bash
cd api
uvicorn server:app --port 8000
```

## 3. Load the extension in Chrome

1. Open `chrome://extensions`
2. Click **Load unpacked**
3. Select the `extension/` folder

The extension icon should now appear in your Chrome toolbar.

## 4. Use it

1. Go to `reddit.com` and click the extension icon - this opens a side
   panel docked to the browser window.
2. On a subreddit listing page, the panel shows misinformation/sentiment tags
   for visible post titles.
3. Click into an individual post - the panel automatically updates to show
   the post, its comments, and a sentiment breakdown chart, once the page has
   finished loading.
4. Use **Check again** to manually re-run analysis at any time.

<p>Misinformation Test Accuracy: 0.8608, F1: 0.8633</p>
<p>Sentiment Test Accuracy: 0.7624, F1: 0.7385</p>