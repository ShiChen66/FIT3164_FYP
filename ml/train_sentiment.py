"""
Fine-tunes the shared encoder and sentiment head on TweetEval
"""
import os
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import time
import torch
from torch.utils.data import DataLoader
from transformers import RobertaTokenizerFast, DataCollatorWithPadding
from sklearn.metrics import accuracy_score, f1_score

from data_prep import load_tweeteval_sentiment
from model import DualHeadRobertaClassifier, BASE_MODEL

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
BATCH_SIZE = 8
LEARNING_RATE = 2e-5
EPOCHS = 2
MAX_SAMPLES_SMOKE_TEST = None

def build_loader(tokenizer, split, max_samples, shuffle):
    dataset = load_tweeteval_sentiment(split=split, max_samples=max_samples)

    def tokenize_fn(batch):
        return tokenizer(batch["text"], truncation=True, max_length=256)

    dataset = dataset.map(tokenize_fn, batched=True)
    dataset.set_format(type="torch", columns=["input_ids", "attention_mask", "label"])

    data_collator = DataCollatorWithPadding(tokenizer=tokenizer)

    def collate_fn(batch):
        labels = torch.tensor([item["label"] for item in batch], dtype=torch.long)
        encoded = data_collator(
            [{"input_ids": item["input_ids"], "attention_mask": item["attention_mask"]} for item in batch]
        )
        return encoded, labels
 
    return DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=shuffle, collate_fn=collate_fn)

def evaluate(model, tokenizer, split="validation", max_samples=None):
    model.eval()
    loader = build_loader(tokenizer, split=split, max_samples=max_samples, shuffle=False)

    all_preds, all_labels = [], []
    with torch.no_grad():
        for encoded, labels in loader:
            encoded = {k: v.to(DEVICE) for k, v in encoded.items()}
            _misinfo_logits, sentiment_logits = model(**encoded)
            preds = torch.argmax(sentiment_logits, dim=-1).cpu().tolist()
            all_preds.extend(preds)
            all_labels.extend(labels.tolist())

    acc = accuracy_score(all_labels, all_preds)
    f1 = f1_score(all_labels, all_preds, average="macro")
    print(f"Sentiment Test Accuracy: {acc:.4f}, Macro F1: {f1:.4f}")
    return acc, f1

def train():
    print(f"Using device: {DEVICE}")
    tokenizer = RobertaTokenizerFast.from_pretrained(BASE_MODEL)
    model = DualHeadRobertaClassifier(base_model_name=BASE_MODEL).to(DEVICE)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE)
    criterion = torch.nn.CrossEntropyLoss()

    print("Starting load_tweeteval_sentiment...")
    t0 = time.time()
    train_loader = build_loader(
        tokenizer, split="train", max_samples=MAX_SAMPLES_SMOKE_TEST, shuffle=True
    )
    print(f"Data ready in {time.time() - t0:.1f}s")

    print("About to start training loop...")
    model.train()
    for epoch in range(EPOCHS):
        print(f"Starting epoch {epoch}")
        total_loss = 0.0
        for batch_idx, (encoded, labels) in enumerate(train_loader):
            encoded = {k: v.to(DEVICE) for k, v in encoded.items()}
            labels = labels.to(DEVICE)

            optimizer.zero_grad()
            _misinfo_logits, sentiment_logits = model(**encoded)
            loss = criterion(sentiment_logits, labels)
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            if batch_idx % 5 == 0:
                print(f"Epoch [{epoch + 1}/{EPOCHS}], Batch [{batch_idx + 1}/{len(train_loader)}], Loss: {loss.item():.4f}")

        avg_loss = total_loss / len(train_loader)
        print(f"Epoch [{epoch + 1}/{EPOCHS}] completed. Average Loss: {avg_loss:.4f}")

    torch.save(model.state_dict(), "sentiment_checkpoint.pt")
    print("Saved model checkpoint to sentiment_checkpoint.pt")

    print("Running evaluation on held-out validation set...")
    evaluate(model, tokenizer, split="validation", max_samples=2000)

if __name__ == "__main__":
    print("Starting training for sentiment analysis...")
    train()