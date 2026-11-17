"""
FlowGuard Model Pipeline

Encapsulates feature extraction, categorical encoding, missing-value imputation,
and Decision Tree inference using the pre-fitted scikit-learn artifacts.
Never refits any transformer at inference time.
"""

import os
import sys
import json
import logging
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import joblib
import numpy as np
import pandas as pd

# Add workspace model files directory to path for UNSWFeatureExtractor imports
PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = PROJECT_ROOT / "model files"
sys.path.insert(0, str(MODEL_DIR))

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

try:
    from feature_extraction import EXPECTED_FEATURES, UNSWFeatureExtractor
except ImportError as err:
    raise RuntimeError(f"Failed to import feature_extraction from {MODEL_DIR}: {err}")

from feature_schema import (
    validate_flow_pre_inference,
    analyze_feature_provenance,
    SCHEMA_VERSION,
    MODEL_VERSION,
)

logger = logging.getLogger("flowguard.pipeline")

# Explicit label semantics verified from UNSW-NB15 training distribution & tree structure
LABEL_MAP = {
    0: "NORMAL",
    1: "ATTACK"
}

CATEGORICAL_FEATURES = ["proto", "state", "service"]


class FlowGuardPipeline:
    """
    Singleton-style inference pipeline combining feature extraction,
    fitted categorical encoding, fitted median imputation, and the decision tree classifier.
    """

    def __init__(self, model_dir: Optional[Union[str, Path]] = None):
        self.model_dir = Path(model_dir) if model_dir else MODEL_DIR
        self.model = None
        self.encoder = None
        self.imputer = None
        self.metadata = {}
        self.extractor = UNSWFeatureExtractor()
        self.is_loaded = False
        self.load_artifacts()

    def load_artifacts(self) -> None:
        """Loads fitted artifacts safely with explicit warnings captured."""
        best_model_path = self.model_dir / "best_model.joblib"
        encoder_path = self.model_dir / "categorical_encoder.joblib"
        imputer_path = self.model_dir / "missing_value_imputer.joblib"
        meta_path = self.model_dir / "metadata.json"

        if not all(p.exists() for p in [best_model_path, encoder_path, imputer_path]):
            raise FileNotFoundError(
                f"Missing model artifact in {self.model_dir}. Required: "
                "best_model.joblib, categorical_encoder.joblib, missing_value_imputer.joblib"
            )

        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                self.metadata = json.load(f)

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            self.model = joblib.load(best_model_path)
            self.encoder = joblib.load(encoder_path)
            self.imputer = joblib.load(imputer_path)

            for w in caught:
                logger.warning("Artifact load warning: %s: %s", w.category.__name__, w.message)

        # Validate feature counts and contract
        assert getattr(self.model, "n_features_in_", None) == 90, "Classifier must expect 90 features"
        assert getattr(self.imputer, "n_features_in_", None) == 90, "Imputer must expect 90 features"
        assert getattr(self.encoder, "n_features_in_", None) == 3, "Encoder must expect 3 features"

        self.is_loaded = True
        logger.info("FlowGuard model pipeline loaded successfully with 90 features.")

    def transform_features(self, df_input: pd.DataFrame) -> np.ndarray:
        """
        Transforms raw flow records or pre-extracted records into the 90-feature
        imputed array ready for classifier scoring.
        Handles schema normalization (IP octet naming, aliases, missing fields).
        """
        if not isinstance(df_input, pd.DataFrame):
            raise TypeError("Expected pandas DataFrame as input.")

        df = df_input.copy()

        # Pre-normalize any known IP octet or column aliases
        alias_map = {
            "resbd ylen": "res_bdy_len",
            "resbdylen": "res_bdy_len",
            "ct_src_ltm": "ct_src_ ltm",
            "src_ip_octet1": "src_ip_octet_1",
            "src_ip_octet2": "src_ip_octet_2",
            "src_ip_octet3": "src_ip_octet_3",
            "src_ip_octet4": "src_ip_octet_4",
            "dst_ip_octet1": "dst_ip_octet_1",
            "dst_ip_octet2": "dst_ip_octet_2",
            "dst_ip_octet3": "dst_ip_octet_3",
            "dst_ip_octet4": "dst_ip_octet_4",
        }
        df = df.rename(columns={k: v for k, v in alias_map.items() if k in df.columns})

        # 1. Feature extraction & normalization (handles IP derivation, absent cols)
        df_extracted = self.extractor.fit_transform(df)

        # Post-extraction alias normalization: map any octet1->octet_1 created by feature_extraction
        for prefix in ["src_ip_", "dst_ip_"]:
            for i in range(1, 5):
                un_underscore = f"{prefix}octet{i}"
                with_underscore = f"{prefix}octet_{i}"
                if un_underscore in df_extracted.columns and with_underscore in EXPECTED_FEATURES:
                    # If with_underscore is nan/missing, copy from un_underscore
                    if with_underscore not in df_extracted.columns or df_extracted[with_underscore].isna().all():
                        df_extracted[with_underscore] = df_extracted[un_underscore]

        # Ensure all EXPECTED_FEATURES are present in the exact order
        for col in EXPECTED_FEATURES:
            if col not in df_extracted.columns:
                df_extracted[col] = np.nan
        df_extracted = df_extracted.loc[:, EXPECTED_FEATURES]

        # 2. Categorical encoding for ['proto', 'state', 'service']
        df_encoded = df_extracted.copy()
        raw_cats = df_encoded[CATEGORICAL_FEATURES].astype(object)
        encoded_cats = self.encoder.transform(raw_cats)
        df_encoded[CATEGORICAL_FEATURES] = encoded_cats

        # 3. Median imputation on the 90 numeric columns
        imputed_array = self.imputer.transform(df_encoded)
        return imputed_array

    def predict_flow(self, flow_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Predicts classification for a single flow dictionary.
        Validates inputs, assesses feature provenance, and returns label, probabilities,
        and policy recommendation.
        """
        is_valid, validation_issues, cleaned_dict = validate_flow_pre_inference(flow_dict)
        provenance = analyze_feature_provenance(flow_dict)

        df = pd.DataFrame([cleaned_dict])
        transformed = self.transform_features(df)
        df_scored = pd.DataFrame(transformed, columns=EXPECTED_FEATURES)

        pred_label = int(self.model.predict(df_scored)[0])
        probabilities = self.model.predict_proba(df_scored)[0]

        prob_normal = float(probabilities[0])
        prob_attack = float(probabilities[1])

        # Separate classifier output from action policy
        # Alert threshold is 0.5 default
        action = "ALERT" if prob_attack >= 0.5 else "ALLOW"
        severity = "HIGH" if prob_attack > 0.8 else ("MEDIUM" if prob_attack >= 0.5 else "LOW")

        return {
            "label": pred_label,
            "label_name": LABEL_MAP.get(pred_label, "UNKNOWN"),
            "probabilities": {
                "normal": round(prob_normal, 4),
                "attack": round(prob_attack, 4)
            },
            "risk_score": round(prob_attack, 4),
            "action": action,
            "severity": severity,
            "model_version": MODEL_VERSION,
            "schema_version": SCHEMA_VERSION,
            "validation_issues": validation_issues,
            "provenance": {
                "counts": provenance["counts"],
                "percentages": provenance["percentages"],
                "imputation_rate": provenance["imputation_rate"],
                "quality_status": provenance["quality_status"],
                "is_reliable": provenance["is_reliable"]
            }
        }

    def predict_batch(self, flows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Predicts classification for a list of flow dictionaries with provenance."""
        if not flows:
            return []
        
        cleaned_flows = []
        provenances = []
        all_issues = []
        for flow in flows:
            _, issues, cleaned = validate_flow_pre_inference(flow)
            prov = analyze_feature_provenance(flow)
            cleaned_flows.append(cleaned)
            provenances.append(prov)
            all_issues.append(issues)

        df = pd.DataFrame(cleaned_flows)
        transformed = self.transform_features(df)
        df_scored = pd.DataFrame(transformed, columns=EXPECTED_FEATURES)

        preds = self.model.predict(df_scored)
        probas = self.model.predict_proba(df_scored)

        results = []
        for i, flow in enumerate(flows):
            label = int(preds[i])
            prob_normal = float(probas[i][0])
            prob_attack = float(probas[i][1])
            action = "ALERT" if prob_attack >= 0.5 else "ALLOW"
            severity = "HIGH" if prob_attack > 0.8 else ("MEDIUM" if prob_attack >= 0.5 else "LOW")
            prov = provenances[i]

            results.append({
                "flow_id": flow.get("flow_id", f"flow-{i}"),
                "label": label,
                "label_name": LABEL_MAP.get(label, "UNKNOWN"),
                "probabilities": {
                    "normal": round(prob_normal, 4),
                    "attack": round(prob_attack, 4)
                },
                "risk_score": round(prob_attack, 4),
                "action": action,
                "severity": severity,
                "model_version": MODEL_VERSION,
                "schema_version": SCHEMA_VERSION,
                "validation_issues": all_issues[i],
                "provenance": {
                    "counts": prov["counts"],
                    "percentages": prov["percentages"],
                    "imputation_rate": prov["imputation_rate"],
                    "quality_status": prov["quality_status"],
                    "is_reliable": prov["is_reliable"]
                }
            })
        return results

    def get_info(self) -> Dict[str, Any]:
        """Returns model metadata, feature contract, and deployment notes."""
        tree = getattr(self.model, "tree_", None)
        return {
            "model_name": str(self.metadata.get("best_model_name", "Decision Tree")),
            "model_version": "DecisionTree_UNSW90_v1.0",
            "schema_version": "flowguard-unsw-90-v1",
            "feature_count": 90,
            "feature_columns": [str(c) for c in EXPECTED_FEATURES],
            "categorical_features": list(CATEGORICAL_FEATURES),
            "classes": [int(c) for c in getattr(self.model, "classes_", [0, 1])],
            "label_semantics": {int(k): v for k, v in LABEL_MAP.items()},
            "historical_f1_score": float(self.metadata.get("selection_score", 0.9802)),
            "historical_score_verified": False,
            "notes": (
                "Historical F1 score (0.9802) is recorded from metadata.json. "
                "The training set (data/unsw_nb15.csv) was not provided with the artifacts; "
                "evaluation protocol and test split cannot be independently verified."
            ),
            "tree_metrics": {
                "max_depth": int(self.model.max_depth) if hasattr(self.model, "max_depth") and self.model.max_depth is not None else None,
                "node_count": int(tree.node_count) if tree is not None else None,
                "n_leaves": int(tree.n_leaves) if tree is not None else None
            }
        }


# Global pipeline instance
_pipeline_instance: Optional[FlowGuardPipeline] = None


def get_pipeline() -> FlowGuardPipeline:
    global _pipeline_instance
    if _pipeline_instance is None:
        _pipeline_instance = FlowGuardPipeline()
    return _pipeline_instance
