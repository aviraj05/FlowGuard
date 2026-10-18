"""
WebSocket Connection Manager for FlowGuard.
Handles real-time event broadcasting to connected frontend clients with ping/pong heartbeat.
"""

import asyncio
import json
import logging
from typing import List
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("flowguard.ws")


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("WebSocket client connected. Total clients: %d", len(self.active_connections))

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info("WebSocket client disconnected. Total clients: %d", len(self.active_connections))

    async def broadcast(self, message: dict) -> None:
        """Broadcasts a JSON-serializable message to all active clients."""
        dead_connections = []
        payload = json.dumps(message)
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception as e:
                logger.warning("Failed to send to client: %s", e)
                dead_connections.append(connection)

        for dead in dead_connections:
            self.disconnect(dead)


manager = ConnectionManager()
