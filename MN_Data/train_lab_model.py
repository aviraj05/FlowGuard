#!/usr/bin/env python3
"""
FlowGuard Phase 4: train and evaluate the lab-native detector

Reads dataset_lab.csv (and dataset_scan.csv if present), compares three models
with 5-fold cross-validation grouped by capture segment (so windows from the
same segment never appear in both train and test), prints precision, recall,
F1, false-positive rate, per-attack-type detection rate and inference latency,
then saves the best model to model_lab.joblib.

Usage:  python3 train_lab_model.py
"""
import os
import time
import warnings

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import f1_score, precision_score, recall_score
from sklearn.model_selection import GroupKFold
from sklearn.tree import DecisionTreeClassifier

from feature_extractor import FEATURES

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))


def load():
    main = pd.read_csv(os.path.join(HERE, "dataset_lab.csv"))
    scan_path = os.path.join(HERE, "dataset_scan.csv")
    if os.path.exists(scan_path):
        extra = pd.read_csv(scan_path)
        extra["segment"] += 1000  # keep segment ids unique across the two files
        main = main[main["attack_type"] != "scan"]  # replace the under-sampled scans
        main = pd.concat([main, extra], ignore_index=True)
    return main


def make_models():
    models = {
        "DecisionTree": DecisionTreeClassifier(max_depth=8, class_weight="balanced", random_state=42),
        "RandomForest": RandomForestClassifier(n_estimators=100, max_depth=10,
                                               class_weight="balanced", random_state=42),
    }
    try:
        from xgboost import XGBClassifier
        models["XGBoost"] = XGBClassifier(n_estimators=100, max_depth=4, learning_rate=0.1,
                                          eval_metric="logloss", random_state=42)
    except Exception:
        models["GradientBoosting"] = GradientBoostingClassifier(n_estimators=100, max_depth=3,
                                                                random_state=42)
    return models


def fpr_of(y, p):
    neg = (y == 0)
    return float(((p == 1) & neg).sum() / max(neg.sum(), 1))


def latency_ms(model, X, n=200):
    idx = np.random.RandomState(0).choice(len(X), size=min(n, len(X)), replace=False)
    t0 = time.perf_counter()
    for i in idx:
        model.predict(X[i:i + 1])
    return (time.perf_counter() - t0) / len(idx) * 1000


def main():
    df = load()
    X = df[FEATURES].values.astype(float)
    y = df["label"].values
    groups = df["segment"].values
    print("rows: %d  (benign %d, attack %d)  segments: %d" %
          (len(df), (y == 0).sum(), (y == 1).sum(), len(set(groups))))
    print("attack types:", df[df.label == 1]["attack_type"].value_counts().to_dict())

    gkf = GroupKFold(n_splits=5)
    summary, oof_all = [], {}
    for name, model in make_models().items():
        P, R, F, FP = [], [], [], []
        oof = np.zeros(len(df), dtype=int)
        for tr, te in gkf.split(X, y, groups):
            model.fit(X[tr], y[tr])
            p = model.predict(X[te])
            oof[te] = p
            P.append(precision_score(y[te], p, zero_division=0))
            R.append(recall_score(y[te], p, zero_division=0))
            F.append(f1_score(y[te], p, zero_division=0))
            FP.append(fpr_of(y[te], p))
        model.fit(X, y)
        lat = latency_ms(model, X)
        oof_all[name] = oof
        summary.append({
            "model": name,
            "precision": np.mean(P), "recall": np.mean(R),
            "f1": np.mean(F), "f1_std": np.std(F),
            "fpr": np.mean(FP), "latency_ms": lat,
        })

    res = pd.DataFrame(summary).round(4)
    print("\n=== 5-FOLD GROUPED CROSS-VALIDATION ===")
    print(res.to_string(index=False))

    print("\n=== DETECTION RATE PER TRAFFIC TYPE (out-of-fold) ===")
    kinds = df["attack_type"].where(df["label"] == 1, df["profile"])
    rows = []
    for kind in sorted(kinds.unique()):
        m = (kinds == kind).values
        row = {"traffic": kind, "n": int(m.sum()),
               "truth": "attack" if df.loc[m, "label"].iloc[0] == 1 else "benign"}
        for name, oof in oof_all.items():
            row[name] = round(float((oof[m] == 1).mean()), 3)
        rows.append(row)
    print(pd.DataFrame(rows).to_string(index=False))
    print("(attack rows: share flagged = detection rate; benign rows: share flagged = false-positive rate)")

    best = res.sort_values(["f1", "latency_ms"], ascending=[False, True]).iloc[0]["model"]
    model = make_models()[best]
    model.fit(X, y)
    path = os.path.join(HERE, "model_lab.joblib")
    joblib.dump({"model": model, "features": FEATURES, "name": best}, path)
    res.to_csv(os.path.join(HERE, "results_model.csv"), index=False)
    print("\nbest model:", best, "-> saved", path)
    if hasattr(model, "feature_importances_"):
        imp = sorted(zip(FEATURES, model.feature_importances_), key=lambda t: -t[1])
        print("feature importance:", ", ".join("%s=%.3f" % t for t in imp))


if __name__ == "__main__":
    main()
