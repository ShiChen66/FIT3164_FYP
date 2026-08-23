"""
Preprocessing pipeline plus loaders for the two datasets
 - Fakeddit -> labels: 0 = fake, 1 = true
 - TweetEval -> labels: 0 = negative, 1 = neutral, 2 = positive
"""

import re
import unicodedata
import pandas as pd

from datasets import load_dataset, Dataset

MARKDOWN_PATTERNS = [
    (re.compile(r"\*\*(.*?)\*\*"), r"\1"),       # **bold**
    (re.compile(r"\*(.*?)\*"), r"\1"),           # *italic*
    (re.compile(r"~~(.*?)~~"), r"\1"),           # ~~strikethrough~~
    (re.compile(r"\^(\S+)"), r"\1"),             # ^superscript
    (re.compile(r"&gt;.*", re.MULTILINE), ""),   # > quoted text
]
URL_PATTERN = re.compile(r"https?://\S+|www\.\S+")

def clean_text(text: str) -> str:
    """Strip Reddit markdown, strip URLs, normalise unicode."""
    if not text:
        return ""
    for pattern, repl in MARKDOWN_PATTERNS:
        text = pattern.sub(repl, text)
    text = URL_PATTERN.sub("", text)
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

FAKEDDIT_PATHS = {
    "train": "data/fakeddit/all_train.tsv",
    "validation": "data/fakeddit/all_validate.tsv",
    "test": "data/fakeddit/all_test_public.tsv",
}

def load_fakeddit(split: str = "train", max_samples: int | None = None) -> Dataset:
    path = FAKEDDIT_PATHS[split]
    df = pd.read_csv(path, sep="\t")
    df = df.loc[:, ~df.columns.str.contains("^Unnamed")]
    df = df.dropna(subset=["clean_title"])

    df["text"] = df["clean_title"].apply(clean_text)
    df = df[df["text"].str.len() > 0]

    if max_samples:
        df = df.head(max_samples)

    df["label"] = df["2_way_label"].astype(int)
    return Dataset.from_pandas(df[["text", "label"]], preserve_index=False)

def load_tweeteval_sentiment(split: str = "train", max_samples: int | None = None) -> Dataset:
    ds = load_dataset("tweet_eval", "sentiment", split=split)
    if max_samples:
        ds = ds.select(range(min(max_samples, len(ds))))
    ds = ds.map(lambda row: {"text": clean_text(row["text"]), "label": int(row["label"])})
    return ds.select_columns(["text", "label"])
 
 
if __name__ == "__main__":
    fk = load_fakeddit(split="train", max_samples=5)
    print("Fakeddit sample:", fk[0])
 
    te = load_tweeteval_sentiment(split="train", max_samples=5)
    print("TweetEval sample:", te[0])