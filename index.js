// index.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3005;
const DEVICES_FILE = path.join(__dirname, 'data', 'devices.json');

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

if (!fs.existsSync(DEVICES_FILE)) fs.writeFileSync(DEVICES_FILE, '[]');

let simulators = {}; // Store intervals per device

function loadDevices() {
    return JSON.parse(fs.readFileSync(DEVICES_FILE));
}

function saveDevices(devices) {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2));
}

function startSimulation(device) {
    const ws = new WebSocket('wss://bio-data-production.up.railway.app');
    ws.on('open', () => {
        simulators[device.id] = setInterval(() => {
            const temp = device.fixed ? device.temperature : (Math.random() * (device.maxT - device.minT) + device.minT);
            const hum = device.fixed ? device.humidity : (Math.random() * (device.maxH - device.minH) + device.minH);
            const ds = device.fixed ? device.dsTemperature : (Math.random() * 5 + 20);

            const payload = {
                username: device.username,
                dsTemperature: parseFloat(ds.toFixed(2)),
                temperature: parseFloat(temp.toFixed(2)),
                humidity: parseFloat(hum.toFixed(2)),
                datetime: new Date().toISOString()
            };
            ws.send(JSON.stringify(payload));
        }, device.interval);
    });
    ws.on('close', () => {
        clearInterval(simulators[device.id]);
        delete simulators[device.id];
    });
}

function stopSimulation(id) {
    clearInterval(simulators[id]);
    delete simulators[id];
}

// Routes
app.get('/', (req, res) => {
    const devices = loadDevices();
    res.render('index', { devices });
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
        fixed: req.body.fixed === 'on',
        temperature: parseFloat(req.body.temperature), // DHT22
        humidity: parseFloat(req.body.humidity),
        dsTemperature: parseFloat(req.body.dsTemperature), // DS18B20
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

// Start existing simulations on startup
loadDevices().forEach(device => {
    if (device.running) startSimulation(device);
});

app.listen(PORT, () => console.log(`🟢 Simulador iniciado en http://localhost:${PORT}`));
