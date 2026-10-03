from huggingface_hub import HfApi

api = HfApi()
REPO_ID = "ShiChenLee/FYP_misinfoandsentiment"

api.create_repo(repo_id=REPO_ID, exist_ok=True)

api.upload_file(
    path_or_fileobj="misinformation_checkpoint.pt",
    path_in_repo="misinformation_checkpoint.pt",
    repo_id=REPO_ID,
)
api.upload_file(
    path_or_fileobj="sentiment_checkpoint.pt",
    path_in_repo="sentiment_checkpoint.pt",
    repo_id=REPO_ID,
)