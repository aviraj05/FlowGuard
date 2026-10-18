import re

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder

from feature_extraction import EXPECTED_FEATURES, UNSWFeatureExtractor, _parse_numeric


CATEGORICAL_FEATURES = ["proto", "state", "service"]


class CleanValues(BaseEstimator, TransformerMixin):
    """Clean values without changing the fixed 90-feature schema."""

    def fit(self, X, y=None):
        if not isinstance(X, pd.DataFrame):
            raise TypeError("CleanValues expects a pandas DataFrame.")
        self.feature_names_in_ = np.asarray([str(c) for c in X.columns], dtype=object)
        return self

    def transform(self, X):
        if not isinstance(X, pd.DataFrame):
            raise TypeError("CleanValues expects a pandas DataFrame.")
        df = X.copy()
        df.columns = [str(c).strip() for c in df.columns]
        rename = {}
        for c in df.columns:
            key = re.sub(r"\s+", "", c).lower()
            if key == "resbd ylen".replace(" ", "") or key == "res_bdy_len":
                rename[c] = "res_bdy_len"
            elif key == "ct_src_ltm":
                rename[c] = "ct_src_ ltm"
        if rename:
            df = df.rename(columns=rename)
        if df.columns.duplicated().any():
            df = df.loc[:, ~df.columns.duplicated(keep="first")].copy()

        # Feature extraction enforces this exact order and inserts absent features as NaN.
        for name in EXPECTED_FEATURES:
            if name not in df.columns:
                df[name] = np.nan
        df = df.loc[:, EXPECTED_FEATURES]

        for c in df.columns:
            if c in CATEGORICAL_FEATURES:
                vals = df[c].astype("string").str.strip().replace({
                    "": pd.NA, "nan": pd.NA, "None": pd.NA, "none": pd.NA,
                    "null": pd.NA, "NA": pd.NA, "N/A": pd.NA, "-": pd.NA
                })
                df[c] = vals.astype(object).where(vals.notna(), np.nan)
            else:
                df[c] = df[c].map(_parse_numeric).astype("float64")
        df.replace([np.inf, -np.inf], np.nan, inplace=True)
        return df

    def get_feature_names_out(self, input_features=None):
        return np.asarray(EXPECTED_FEATURES, dtype=object)


def build_preprocessing_pipeline(scale_numeric=False):
    """Return a preprocessing-only pipeline with exactly 90 output features."""
    numeric_features = [c for c in EXPECTED_FEATURES if c not in CATEGORICAL_FEATURES]
    categorical_features = [c for c in EXPECTED_FEATURES if c in CATEGORICAL_FEATURES]

    numeric_steps = [("imputer", SimpleImputer(strategy="median", keep_empty_features=True))]
    if scale_numeric:
        from sklearn.preprocessing import StandardScaler
        numeric_steps.append(("scaler", StandardScaler()))

    numeric_pipeline = Pipeline(numeric_steps)
    categorical_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent", keep_empty_features=True)),
        ("encoder", OrdinalEncoder(
            handle_unknown="use_encoded_value",
            unknown_value=-1,
            encoded_missing_value=-1,
            dtype=np.float64
        ))
    ])

    # ColumnTransformer groups columns, so its default output order is grouped.
    # This transformer explicitly restores the model's expected original 90-column order.
    from sklearn.preprocessing import FunctionTransformer

    def restore_order(array):
        array = np.asarray(array)
        numeric_map = {name: i for i, name in enumerate(numeric_features)}
        cat_map = {name: len(numeric_features) + i for i, name in enumerate(categorical_features)}
        return array[:, [numeric_map.get(name, cat_map.get(name)) for name in EXPECTED_FEATURES]]

    column_transformer = ColumnTransformer(
        transformers=[
            ("numeric", numeric_pipeline, numeric_features),
            ("categorical", categorical_pipeline, categorical_features)
        ],
        remainder="drop",
        verbose_feature_names_out=False
    )

    return Pipeline([
        ("feature_extraction", UNSWFeatureExtractor()),
        ("clean_values", CleanValues()),
        ("preprocessor", column_transformer),
        ("restore_model_order", FunctionTransformer(restore_order, feature_names_out="one-to-one"))
    ])


def get_model_feature_names():
    return list(EXPECTED_FEATURES)
