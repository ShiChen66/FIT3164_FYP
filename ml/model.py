"""
Roberta encoder with two classification heads.
 - misinformation head: [not_misleading, misleading]
 - sentiment head: [negative, neutral, positive]
"""

from dataclasses import dataclass

import torch
from torch import nn
from transformers import RobertaModel, RobertaTokenizerFast

BASE_MODEL = "roberta-base"
MISINFORMATION_LABELS = ["not_misleading", "misleading"]
SENTIMENT_LABELS = ["negative", "neutral", "positive"]

class ClassificationHead(nn.Module):
    def __init__(self, hidden_size, num_labels, dropout: float = 0.1):
        super().__init__()
        self.dropout = nn.Dropout(dropout)
        self.dense = nn.Linear(hidden_size, hidden_size)
        self.out_proj = nn.Linear(hidden_size, num_labels)
        self.activation = nn.Tanh()

    def forward(self, cls_embedding):
        x = self.dropout(cls_embedding)
        x = self.activation(self.dense(x))
        x = self.dropout(x)
        return self.out_proj(x)

class DualHeadRobertaClassifier(nn.Module):
    def __init__(self, base_model_name: str = BASE_MODEL):
        super().__init__()
        self.encoder = RobertaModel.from_pretrained(base_model_name)
        hidden_size = self.encoder.config.hidden_size
        self.misinformation_head = ClassificationHead(hidden_size, len(MISINFORMATION_LABELS))
        self.sentiment_head = ClassificationHead(hidden_size, len(SENTIMENT_LABELS))
 
    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor):
        outputs = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        cls_embedding = outputs.last_hidden_state[:, 0, :]
        misinformation_logits = self.misinformation_head(cls_embedding)
        sentiment_logits = self.sentiment_head(cls_embedding)
        return misinformation_logits, sentiment_logits 

@dataclass
class Prediction:
    misinformation_label: str
    misinformation_confidence: float
    sentiment_label: str
    sentiment_scores: dict
 
 
def predict(model: DualHeadRobertaClassifier, tokenizer, text: str, device="cpu") -> Prediction:
    model.eval()
    encoded = tokenizer(text, truncation=True, padding=True, max_length=256, return_tensors="pt").to(device)
    with torch.no_grad():
        misinfo_logits, sentiment_logits = model(**encoded)
 
    misinfo_probs = torch.softmax(misinfo_logits, dim=-1)[0]
    sentiment_probs = torch.softmax(sentiment_logits, dim=-1)[0]
 
    misinfo_idx = int(torch.argmax(misinfo_probs))
    sentiment_idx = int(torch.argmax(sentiment_probs))
 
    return Prediction(
        misinformation_label=MISINFORMATION_LABELS[misinfo_idx],
        misinformation_confidence=float(misinfo_probs[misinfo_idx]),
        sentiment_label=SENTIMENT_LABELS[sentiment_idx],
        sentiment_scores={
            label: float(p) for label, p in zip(SENTIMENT_LABELS, sentiment_probs.tolist())
        },
    )
 
 
if __name__ == "__main__":
    tokenizer = RobertaTokenizerFast.from_pretrained(BASE_MODEL)
    model = DualHeadRobertaClassifier()
 
    sample_text = "RoBERTa outperforms BERT on most benchmark tasks."
    result = predict(model, tokenizer, sample_text)
    print(result)