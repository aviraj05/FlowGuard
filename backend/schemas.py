"""
Pydantic schemas for the FlowGuard REST and WebSocket API.
Defines strict type contracts for requests and responses.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class FlowRecordInput(BaseModel):
    """Network flow input matching UNSW-NB15 fields or raw flow capture."""
    flow_id: Optional[str] = Field(default=None, description="Client or exporter flow identifier")
    srcip: Optional[str] = Field(default="0.0.0.0", description="Source IPv4 address")
    sport: Optional[int] = Field(default=0, ge=0, le=65535, description="Source port")
    dstip: Optional[str] = Field(default="0.0.0.0", description="Destination IPv4 address")
    dsport: Optional[int] = Field(default=0, ge=0, le=65535, description="Destination port")
    proto: Optional[str] = Field(default="tcp", description="Protocol: tcp, udp, etc.")
    state: Optional[str] = Field(default="CON", description="TCP state or flow state")
    dur: Optional[float] = Field(default=0.0, ge=0.0, description="Flow duration in seconds")
    sbytes: Optional[int] = Field(default=0, ge=0, description="Source to destination bytes")
    dbytes: Optional[int] = Field(default=0, ge=0, description="Destination to source bytes")
    Spkts: Optional[int] = Field(default=0, ge=0, description="Source packets")
    Dpkts: Optional[int] = Field(default=0, ge=0, description="Destination packets")
    service: Optional[str] = Field(default="-", description="Service: http, dns, ftp, etc.")
    sttl: Optional[int] = Field(default=64, ge=0, le=255, description="Source TTL")
    dttl: Optional[int] = Field(default=60, ge=0, le=255, description="Destination TTL")
    swin: Optional[int] = Field(default=255, ge=0, description="Source window")
    dwin: Optional[int] = Field(default=255, ge=0, description="Destination window")
    extra_features: Optional[Dict[str, Any]] = Field(default=None, description="Optional pre-computed 90-feature fields")

    class Config:
        extra = "allow"


class FlowBatchInput(BaseModel):
    """Batch prediction request with bounded limit."""
    flows: List[FlowRecordInput] = Field(..., max_length=100, description="Maximum 100 flows per batch")


class Probabilities(BaseModel):
    normal: float
    attack: float


class FlowPredictionResponse(BaseModel):
    flow_id: str
    label: int = Field(..., description="0 = Normal, 1 = Attack")
    label_name: str = Field(..., description="'NORMAL' or 'ATTACK'")
    probabilities: Probabilities
    risk_score: float = Field(..., ge=0.0, le=1.0)
    action: str = Field(..., description="'ALLOW', 'ALERT', or 'REVIEW'")
    severity: str = Field(..., description="'LOW', 'MEDIUM', or 'HIGH'")
    model_version: str
    schema_version: str = "flowguard-unsw-90-v1"
    timestamp: str


class HealthResponse(BaseModel):
    status: str
    service: str
    model_loaded: bool
    model_version: str
    schema_version: str
    os_environment: str
    mininet_supported: bool
    collector_mode: str
    uptime_seconds: float


class ModelInfoResponse(BaseModel):
    model_name: str
    model_version: str
    schema_version: str
    feature_count: int
    feature_columns: List[str]
    categorical_features: List[str]
    classes: List[int]
    label_semantics: Dict[int, str]
    historical_f1_score: float
    historical_score_verified: bool
    notes: str
    tree_metrics: Dict[str, Any]


class BackendFailRequest(BaseModel):
    failed: bool
    operator: Optional[str] = "admin"
    reason: Optional[str] = "Simulated lab fault"


class LabActionResponse(BaseModel):
    status: str
    backend_id: str
    failed: bool
    isolated_lab_only: bool
    timestamp: str
    message: str


class EventItem(BaseModel):
    event_id: str
    timestamp: str
    src_ip: str
    dst_ip: str
    src_port: int
    dst_port: int
    proto: str
    service: str
    label: int
    label_name: str
    risk_score: float
    action: str
    severity: str
    source_type: str


class DashboardSnapshot(BaseModel):
    status: str
    model_version: str
    total_events: int
    normal_count: int
    attack_count: int
    last_update: str
    backends: List[Dict[str, Any]]
    recent_events: List[EventItem]
