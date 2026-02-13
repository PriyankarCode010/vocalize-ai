const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

let clients = [];

wss.on('connection', (ws) => {
    console.log('Client connected');
    clients.push(ws);

    // Simple 1-to-1 pairing: If 2 clients, tell 1st to call 2nd
    if (clients.length === 2) {
        console.log('Match found, notifying initiator');
        clients[0].send(JSON.stringify({ type: 'ready-to-call' }));
    }

    ws.on('message', (message) => {
        // Broadcast to the other client (simple relay)
        clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message.toString());
            }
        });
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        clients = clients.filter((client) => client !== ws);
    });
});

console.log('Signaling server running on ws://localhost:8080');
