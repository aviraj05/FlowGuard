import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from preprocessing import build_preprocessing_pipeline

DATA_PATH = "data/unsw_nb15.csv"
OUTPUT_PATH = "preprocessing_pipeline.joblib"

df = pd.read_csv(DATA_PATH, encoding="cp1252", low_memory=False)
df.columns = [str(c).strip() for c in df.columns]

target_col = next((c for c in df.columns if c.strip().lower() == "label"), None)
if target_col is None:
    raise KeyError("Binary target column 'Label'/'label' was not found.")

y = df[target_col].copy()
X = df.drop(columns=[
    c for c in df.columns if c.strip().lower() in {"label", "attack_cat"}
]).copy()

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

preprocessor = build_preprocessing_pipeline(scale_numeric=False)
X_train_processed = preprocessor.fit_transform(X_train, y_train)
X_test_processed = preprocessor.transform(X_test)

assert X_train_processed.shape == (len(X_train), 90), (
    f"Expected exactly 90 training features, got {X_train_processed.shape}"
)
assert X_test_processed.shape == (len(X_test), 90), (
    f"Expected exactly 90 test features, got {X_test_processed.shape}"
)
assert np.isfinite(X_train_processed).all(), "Non-finite values remain in training data."
assert np.isfinite(X_test_processed).all(), "Non-finite values remain in test data."

joblib.dump(preprocessor, OUTPUT_PATH)

print("Original X_train:", X_train.shape)
print("Original X_test:", X_test.shape)
print("Processed X_train:", X_train_processed.shape)
print("Processed X_test:", X_test_processed.shape)
print("Feature count locked to 90.")
print("Fitted pipeline saved to:", OUTPUT_PATH)
print("Use this same saved pipeline for test data and deployment; do not refit it.")

# Save y_train/y_test separately if the model-training script needs them.
