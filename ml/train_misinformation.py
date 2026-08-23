"""
Fine-tunes the shared encoder and misinformation head on Fakeddit
"""
import os
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import time
import torch
from torch.utils.data import DataLoader
from transformers import RobertaTokenizerFast, DataCollatorWithPadding

from data_prep import load_fakeddit
from model import DualHeadRobertaClassifier, BASE_MODEL

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
BATCH_SIZE = 8
LEARNING_RATE = 2e-5
EPOCHS = 1
MAX_SAMPLES_SMOKE_TEST = 2000


def train():
    print(f"Using device: {DEVICE}")
    tokenizer = RobertaTokenizerFast.from_pretrained(BASE_MODEL)
    model = DualHeadRobertaClassifier(base_model_name=BASE_MODEL).to(DEVICE)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE)
    criterion = torch.nn.CrossEntropyLoss()

    print("Starting load_fakeddit...")
    t0 = time.time()
    train_dataset = load_fakeddit(split="train", max_samples=MAX_SAMPLES_SMOKE_TEST)
    print(f"load_fakeddit finished in {time.time() - t0:.1f}s, {len(train_dataset)} rows")

    print("Tokenizing full dataset...")
    t0 = time.time()

    def tokenize_fn(batch):
        return tokenizer(batch["text"], truncation=True, max_length=256)

    train_dataset = train_dataset.map(tokenize_fn, batched=True)
    train_dataset.set_format(type="torch", columns=["input_ids", "attention_mask", "label"])
    print(f"Tokenization finished in {time.time() - t0:.1f}s")

    # Collate now only PADS already-tokenized tensors — no repeated tokenizer calls.
    data_collator = DataCollatorWithPadding(tokenizer=tokenizer)

    def collate_fn(batch):
        labels = torch.tensor([item["label"] for item in batch], dtype=torch.long)
        encoded = data_collator(
            [{"input_ids": item["input_ids"], "attention_mask": item["attention_mask"]} for item in batch]
        )
        return encoded, labels

    train_loader = DataLoader(
        train_dataset, batch_size=BATCH_SIZE, shuffle=True, collate_fn=collate_fn
    )

    print("About to start training loop...")
    model.train()
    for epoch in range(EPOCHS):
        print(f"Starting epoch {epoch}")
        total_loss = 0.0
        for batch_idx, (encoded, labels) in enumerate(train_loader):
            encoded = {k: v.to(DEVICE) for k, v in encoded.items()}
            labels = labels.to(DEVICE)

            optimizer.zero_grad()
            misinformation_logits, _ = model(**encoded)
            loss = criterion(misinformation_logits, labels)
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            if batch_idx % 5 == 0:
                print(f"Epoch [{epoch + 1}/{EPOCHS}], Batch [{batch_idx + 1}/{len(train_loader)}], Loss: {loss.item():.4f}")

        avg_loss = total_loss / len(train_loader)
        print(f"Epoch [{epoch + 1}/{EPOCHS}] completed. Average Loss: {avg_loss:.4f}")

    torch.save(model.state_dict(), "misinformation_checkpoint.pt")
    print("Saved model checkpoint to misinformation_checkpoint.pt")


if __name__ == "__main__":
    print("Starting training for misinformation detection...")
    train()