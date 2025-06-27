// index.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3005;
const DEVICES_FILE = path.join(__dirname, 'data', 'devices.json');

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

if (!fs.existsSync(DEVICES_FILE)) fs.writeFileSync(DEVICES_FILE, '[]');

let simulators = {}; // Stores active simulators by device ID

function loadDevices() {
    return JSON.parse(fs.readFileSync(DEVICES_FILE));
}

function saveDevices(devices) {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2));
}

function startSimulation(device) {
    if (simulators[device.id]) {
        console.log(`[${device.username}] 🔁 Ya hay un simulador activo. Se omite.`);
        return;
    }

    let ws;
    let sendInterval = null;
    let pingInterval = null;

    const connect = () => {
        ws = new WebSocket('wss://bio-data-production.up.railway.app');

        ws.on('open', () => {
            console.log(`[${device.username}] ✅ WebSocket conectado`);

            sendInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    const temp = device.fixed ? device.temperature : (Math.random() * (device.maxT - device.minT) + device.minT);
                    const hum = device.fixed ? device.humidity : (Math.random() * (device.maxH - device.minH) + device.minH);
                    const ds = device.fixed ? device.dsTemperature : (Math.random() * (device.maxDsT - device.minDsT) + device.minDsT);

                    const payload = {
                        username: device.username,
                        dsTemperature: parseFloat(ds.toFixed(2)),
                        temperature: parseFloat(temp.toFixed(2)),
                        humidity: parseFloat(hum.toFixed(2)),
                        datetime: new Date().toISOString()
                    };

                    ws.send(JSON.stringify(payload));
                }
            }, device.interval);

            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                    console.log(`[${device.username}] 📤 Ping enviado`);
                }
            }, 25000);

            simulators[device.id] = {
                ws,
                sendInterval,
                pingInterval
            };
        });

        ws.on('pong', () => {
            console.log(`[${device.username}] 📶 Pong recibido`);
        });

        ws.on('close', () => {
            console.warn(`[${device.username}] ⚠️ WebSocket cerrado. Reintentando en 5s...`);
            clearInterval(sendInterval);
            clearInterval(pingInterval);
            delete simulators[device.id];
            setTimeout(connect, 5000);
        });

        ws.on('error', (err) => {
            console.error(`[${device.username}] ❌ Error: ${err.message}`);
        });
    };

    connect();
}

function stopSimulation(id) {
    const sim = simulators[id];
    if (sim) {
        clearInterval(sim.sendInterval);
        clearInterval(sim.pingInterval);
        if (sim.ws && sim.ws.readyState === WebSocket.OPEN) {
            sim.ws.close();
        }
    }
    delete simulators[id];
}

// Routes
app.get('/', (req, res) => {
    const devices = loadDevices();
    res.render('index', { devices });
});

app.get('/edit/:id', (req, res) => {
    const devices = loadDevices();
    const device = devices.find(d => d.id === req.params.id);
    if (!device) return res.status(404).send('Device not found');
    res.render('edit', { device });
});

app.post('/update/:id', (req, res) => {
    let devices = loadDevices();
    const idx = devices.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).send('Device not found');

    const updated = {
        ...devices[idx],
        username: req.body.username,
        minT: parseFloat(req.body.minT),
        maxT: parseFloat(req.body.maxT),
        minH: parseFloat(req.body.minH),
        maxH: parseFloat(req.body.maxH),
        minDsT: parseFloat(req.body.minDsT),
        maxDsT: parseFloat(req.body.maxDsT),
        fixed: req.body.fixed === 'on',
        temperature: parseFloat(req.body.temperature),
        humidity: parseFloat(req.body.humidity),
        dsTemperature: parseFloat(req.body.dsTemperature),
        interval: parseInt(req.body.interval)
    };

    devices[idx] = updated;
    saveDevices(devices);

    if (updated.running) {
        stopSimulation(updated.id);
        startSimulation(updated);
    }

    res.redirect('/');
});

app.post('/add', (req, res) => {
    const devices = loadDevices();
    const newDevice = {
        id: uuidv4(),
        username: req.body.username,
        minT: parseFloat(req.body.minT),
        maxT: parseFloat(req.body.maxT),
        minH: parseFloat(req.body.minH),
        maxH: parseFloat(req.body.maxH),
        minDsT: parseFloat(req.body.minDsT),
        maxDsT: parseFloat(req.body.maxDsT),
        fixed: req.body.fixed === 'on',
        temperature: parseFloat(req.body.temperature),
        humidity: parseFloat(req.body.humidity),
        dsTemperature: parseFloat(req.body.dsTemperature),
        interval: parseInt(req.body.interval),
        running: true
    };
    devices.push(newDevice);
    saveDevices(devices);
    startSimulation(newDevice);
    res.redirect('/');
});

app.post('/stop/:id', (req, res) => {
    const devices = loadDevices();
    const idx = devices.findIndex(d => d.id === req.params.id);
    if (idx !== -1) {
        devices[idx].running = false;
        saveDevices(devices);
        stopSimulation(req.params.id);
    }
    res.redirect('/');
});

app.post('/delete/:id', (req, res) => {
    let devices = loadDevices();
    devices = devices.filter(d => d.id !== req.params.id);
    saveDevices(devices);
    stopSimulation(req.params.id);
    res.redirect('/');
});

// Iniciar simulaciones activas al arrancar el servidor
loadDevices().forEach(device => {
    if (device.running) startSimulation(device);
});

app.listen(PORT, () => console.log(`🟢 Simulator running at http://localhost:${PORT}`));
