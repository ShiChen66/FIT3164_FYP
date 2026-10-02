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

from model import DualHeadRobertaClassifier, predict, load_model, BASE_MODEL

app = FastAPI(title="Reddit AI Checker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

tokenizer = RobertaTokenizerFast.from_pretrained(BASE_MODEL)

ML_DIR = os.path.join(os.path.dirname(__file__), "..", "ml")
MISINFO_CHECKPOINT = os.path.join(ML_DIR, "misinformation_checkpoint.pt")
SENTIMENT_CHECKPOINT = os.path.join(ML_DIR, "sentiment_checkpoint.pt")

def load_or_warn(checkpoint_path: str, label: str) -> DualHeadRobertaClassifier:
    if os.path.exists(checkpoint_path):
        print(f"Loaded {label} weights from {checkpoint_path}")
        return load_model(checkpoint_path)
    print(f"WARNING: {checkpoint_path} not found - serving {label} predictions from an UNTRAINED model.")
    model = DualHeadRobertaClassifier()
    model.eval()
    return model

misinfo_model = load_or_warn(MISINFO_CHECKPOINT, "misinformation")
sentiment_model = load_or_warn(SENTIMENT_CHECKPOINT, "sentiment")
 
class AnalyseRequest(BaseModel):
    texts: list[str]

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/analyse")
def analyse(req: AnalyseRequest):
    results = []
    for text in req.texts:
        pred = predict(misinfo_model, sentiment_model, tokenizer, text)
        results.append({
            "text": text,
            "misinformation_label": pred.misinformation_label,
            "misinformation_confidence": pred.misinformation_confidence,
            "sentiment_label": pred.sentiment_label,
        })
    return {"results": results}