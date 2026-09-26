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
 
from model import DualHeadRobertaClassifier, predict, BASE_MODEL
 
app = FastAPI(title="Reddit AI Checker API")
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)
 
tokenizer = RobertaTokenizerFast.from_pretrained(BASE_MODEL)
model = DualHeadRobertaClassifier()
 
MISINFO_CHECKPOINT = os.path.join(os.path.dirname(__file__), "..", "ml", "misinformation_checkpoint.pt")
if os.path.exists(MISINFO_CHECKPOINT):
    import torch
    model.load_state_dict(torch.load(MISINFO_CHECKPOINT, map_location="cpu"))
    print(f"Loaded trained weights from {MISINFO_CHECKPOINT}")
else:
    print("WARNING: no checkpoint found - serving predictions from an untrained model.")
 
model.eval()
 

class AnalyseRequest(BaseModel):
    texts: list[str]
 
 
@app.get("/health")
def health():
    return {"status": "ok"}
 
 
@app.post("/analyse")
def analyse(req: AnalyseRequest):
    results = []
    for text in req.texts:
        pred = predict(model, tokenizer, text)
        results.append({
            "text": text,
            "misinformation_label": pred.misinformation_label,
            "misinformation_confidence": pred.misinformation_confidence,
            "sentiment_label": pred.sentiment_label,
        })
    return {"results": results}