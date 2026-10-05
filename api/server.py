"""
server.py
 
Minimal backend bridging the extension's contract to ml/model.py's predict().
 
Request  (from popup.js):  POST /analyse  { "texts": ["title 1", "title 2", ...] }
Response (to popup.js):    { "results": [
                                { "text": "...", "misinformation_label": "...",
                                  "misinformation_confidence": 0.0, "sentiment_label": "..." },
                                ...
                            ] }
 
Run with:
pip install fastapi uvicorn
uvicorn server:app --port 8000 --reload
run from inside api/
"""
 
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "ml"))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import RobertaTokenizerFast
from huggingface_hub import hf_hub_download

from model import DualHeadRobertaClassifier, predict, load_model, BASE_MODEL
from data_prep import clean_text

app = FastAPI(title="Reddit AI Checker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

tokenizer = RobertaTokenizerFast.from_pretrained(BASE_MODEL)

REPO_ID = "ShiChenLee/FYP_misinfoandsentiment"

def load_or_warn(filename: str, label: str) -> DualHeadRobertaClassifier:
    try:
        checkpoint_path = hf_hub_download(repo_id=REPO_ID, filename=filename)
        print(f"Loaded {label} weights from Hugging Face Hub: {REPO_ID}/{filename}")
        return load_model(checkpoint_path)
    except Exception as e:
        print(f"WARNING: could not fetch {filename} from Hub ({e}) - serving {label} predictions from an UNTRAINED model.")
        model = DualHeadRobertaClassifier()
        model.eval()
        return model

misinfo_model = load_or_warn("misinformation_checkpoint.pt", "misinformation")
sentiment_model = load_or_warn("sentiment_checkpoint.pt", "sentiment")
 
class AnalyseRequest(BaseModel):
    texts: list[str]

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/analyse")
def analyse(req: AnalyseRequest):
    results = []
    for text in req.texts:
        cleaned = clean_text(text)
        pred = predict(misinfo_model, sentiment_model, tokenizer, cleaned)

        print("----")
        print("original:", text[:80])
        print("cleaned: ", cleaned[:80])
        print("sentiment_scores:", pred.sentiment_scores)
        print("sentiment_label:", pred.sentiment_label)

        results.append({
            "text": text,
            "misinformation_label": pred.misinformation_label,
            "misinformation_confidence": pred.misinformation_confidence,
            "sentiment_label": pred.sentiment_label,
        })
    return {"results": results}