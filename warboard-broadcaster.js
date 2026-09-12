'use strict';

/**
 * Warboard Real-Time Broadcaster
 * 
 * Provides WebSocket (/ws/warboard) and Server-Sent Events (/api/warboard/stream)
 * real-time broadcasting.
 * 
 * Instead of 50 browser tabs each polling Torn API every few seconds,
 * the backend polls ONCE and broadcasts to all connected clients.
 */

const { WebSocketServer, WebSocket } = require('ws');

class WarboardBroadcaster {
    constructor() {
        this.wss = null;
        this.wsClients = new Set();
        this.sseClients = new Set();
        this.lastPayload = null;
        this.lastPayloadTimestamp = 0;
    }

    /**
     * Attach WebSocketServer to the existing HTTP server instance
     */
    attachHttpServer(httpServer) {
        if (!httpServer) return;

        this.wss = new WebSocketServer({
            server: httpServer,
            path: '/ws/warboard'
        });

        this.wss.on('connection', (ws, req) => {
            ws.isAlive = true;
            this.wsClients.add(ws);

            // Send cached payload immediately upon connection if fresh
            if (this.lastPayload && (Date.now() - this.lastPayloadTimestamp < 30000)) {
                try {
                    ws.send(JSON.stringify({ type: 'warboard_update', data: this.lastPayload, ts: this.lastPayloadTimestamp }));
                } catch(e) {}
            }

            ws.on('pong', () => { ws.isAlive = true; });

            ws.on('message', (msg) => {
                try {
                    const parsed = JSON.parse(msg.toString());
                    if (parsed.type === 'ping') {
                        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
                    }
                } catch(e) {}
            });

            ws.on('close', () => {
                this.wsClients.delete(ws);
            });

            ws.on('error', () => {
                this.wsClients.delete(ws);
            });
        });

        // Ping interval every 25 seconds to keep connections alive through proxies / Render
        this.heartbeatInterval = setInterval(() => {
            for (const ws of this.wsClients) {
                if (ws.isAlive === false) {
                    this.wsClients.delete(ws);
                    ws.terminate();
                    continue;
                }
                ws.isAlive = false;
                try { ws.ping(); } catch(e) {}
            }
        }, 25000);

        console.log('[Broadcaster] WebSocket server mounted at /ws/warboard');
    }

    /**
     * Express middleware for Server-Sent Events (/api/warboard/stream)
     */
    handleSse(req, res) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        res.flushHeaders?.();

        const client = { id: Date.now() + Math.random(), res };
        this.sseClients.add(client);

        // Immediately send initial payload
        if (this.lastPayload) {
            res.write(`data: ${JSON.stringify({ type: 'warboard_update', data: this.lastPayload, ts: this.lastPayloadTimestamp })}\n\n`);
        }

        // Heartbeat comment every 15s to keep connection alive
        const sseKeepAlive = setInterval(() => {
            try { res.write(': keepalive\n\n'); } catch(e) {}
        }, 15000);

        req.on('close', () => {
            clearInterval(sseKeepAlive);
            this.sseClients.delete(client);
        });
    }

    /**
     * Broadcast live warboard update to all connected clients
     */
    broadcastWarboardUpdate(warboardData) {
        if (!warboardData) return;

        this.lastPayload = warboardData;
        this.lastPayloadTimestamp = Date.now();
        const messageStr = JSON.stringify({
            type: 'warboard_update',
            data: warboardData,
            ts: this.lastPayloadTimestamp
        });

        // Broadcast to WebSocket clients
        for (const ws of this.wsClients) {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(messageStr); } catch(e) {}
            }
        }

        // Broadcast to SSE clients
        for (const client of this.sseClients) {
            try {
                client.res.write(`data: ${messageStr}\n\n`);
            } catch(e) {
                this.sseClients.delete(client);
            }
        }
    }

    /**
     * Broadcast priority alert event (chain dropping, enemy landed, etc.)
     */
    broadcastAlert(alert) {
        const messageStr = JSON.stringify({
            type: 'war_alert',
            alert,
            ts: Date.now()
        });

        for (const ws of this.wsClients) {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(messageStr); } catch(e) {}
            }
        }

        for (const client of this.sseClients) {
            try { client.res.write(`data: ${messageStr}\n\n`); } catch(e) {}
        }
    }

    getClientStats() {
        return {
            wsCount: this.wsClients.size,
            sseCount: this.sseClients.size,
            totalConnected: this.wsClients.size + this.sseClients.size,
            lastBroadcastTs: this.lastPayloadTimestamp
        };
    }
}

const warboardBroadcaster = new WarboardBroadcaster();

module.exports = warboardBroadcaster;
