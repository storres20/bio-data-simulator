// index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const Simulation = require('./models/simulation.model');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// MongoDB Connection
mongoose.connect(process.env.DATABASE_URL, { dbName: 'bio-data' });
mongoose.connection.once('open', () => console.log('✅ Connected to MongoDB'));

let simulators = {}; // Active simulators

function startSimulation(sim) {
    // Forzar limpieza previa si ya existe
    if (simulators[sim._id]) {
        console.warn(`[${sim.username}] 🧹 Simulador previo detectado. Reiniciando...`);
        stopSimulation(sim._id);
    }

    console.log(`[${sim.username}] ⚙️ Iniciando nuevo simulador con intervalo ${sim.interval} ms...`);

    let ws;
    let sendInterval = null;
    let pingInterval = null;

    const connect = () => {
        ws = new WebSocket('wss://bio-data-production.up.railway.app');

        ws.on('open', () => {
            console.log(`[${sim.username}] ✅ WebSocket conectado`);

            sendInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    const temp = sim.fixed ? sim.temperature : (Math.random() * (sim.maxT - sim.minT) + sim.minT);
                    const hum = sim.fixed ? sim.humidity : (Math.random() * (sim.maxH - sim.minH) + sim.minH);
                    const ds = sim.fixed ? sim.dsTemperature : (Math.random() * (sim.maxDsT - sim.minDsT) + sim.minDsT);

                    const payload = {
                        username: sim.username,
                        dsTemperature: parseFloat(ds.toFixed(2)),
                        temperature: parseFloat(temp.toFixed(2)),
                        humidity: parseFloat(hum.toFixed(2)),
                        datetime: new Date().toISOString()
                    };

                    ws.send(JSON.stringify(payload));
                }
            }, sim.interval);

            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                    console.log(`[${sim.username}] 📤 Ping enviado`);
                }
            }, 25000);

            simulators[sim._id] = { ws, sendInterval, pingInterval };
            console.log(`[${sim.username}] 🚀 Simulador iniciado y registrado`);
        });

        ws.on('pong', () => console.log(`[${sim.username}] 📶 Pong recibido`));

        ws.on('close', async () => {
            console.warn(`[${sim.username}] ⚠️ WebSocket cerrado`);
            stopSimulation(sim._id);

            const stillExists = await Simulation.exists({ _id: sim._id });
            if (stillExists) {
                console.log(`[${sim.username}] 🔄 Simulador existe. Reintentando conexión en 5s...`);
                setTimeout(connect, 5000);
            } else {
                console.log(`[${sim.username}] 🧹 Simulador eliminado. No se reconecta.`);
            }
        });

        ws.on('error', err => console.error(`[${sim.username}] ❌ Error: ${err.message}`));
    };

    connect();
}

function stopSimulation(id) {
    const sim = simulators[id];
    if (sim) {
        clearInterval(sim.sendInterval);
        clearInterval(sim.pingInterval);

        if (sim.ws) {
            try {
                sim.ws.terminate(); // cierre inmediato
                console.log(`[${id}] 🔌 WebSocket terminado por stopSimulation`);
            } catch (e) {
                console.error(`[${id}] ⚠️ Error al terminar WS: ${e.message}`);
            }
        }

        console.log(`[${id}] 🧹 Simulador detenido y removido de memoria`);
    } else {
        console.log(`[${id}] ⚠️ No se encontró simulador activo en memoria`);
    }

    delete simulators[id];
}

async function cleanupOrphanSimulators() {
    const dbSims = await Simulation.find().select('_id');
    const dbIds = dbSims.map(sim => sim._id.toString());

    Object.keys(simulators).forEach(id => {
        if (!dbIds.includes(id)) {
            console.warn(`🧹 Simulador huérfano detectado y detenido: ${id}`);
            stopSimulation(id);
        }
    });
}

// Routes
app.get('/', async (req, res) => {
    const devices = await Simulation.find();
    res.render('index', { devices });
});

app.get('/edit/:id', async (req, res) => {
    const device = await Simulation.findById(req.params.id);
    if (!device) return res.status(404).send('Simulation not found');
    res.render('edit', { device });
});

app.post('/update/:id', async (req, res) => {
    const updated = await Simulation.findByIdAndUpdate(
        req.params.id,
        {
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
        },
        { new: true }
    );

    stopSimulation(updated._id);
    startSimulation(updated);
    await cleanupOrphanSimulators();
    res.redirect('/');
});

app.post('/add', async (req, res) => {
    const sim = new Simulation({
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
    });
    const saved = await sim.save();
    startSimulation(saved);
    await cleanupOrphanSimulators();
    res.redirect('/');
});

app.post('/stop/:id', async (req, res) => {
    await Simulation.findByIdAndUpdate(req.params.id, { running: false });
    stopSimulation(req.params.id);
    await cleanupOrphanSimulators();
    res.redirect('/');
});

app.post('/start/:id', async (req, res) => {
    const sim = await Simulation.findByIdAndUpdate(
        req.params.id,
        { running: true },
        { new: true }
    );
    if (sim) startSimulation(sim);
    await cleanupOrphanSimulators();
    res.redirect('/');
});

app.post('/delete/:id', async (req, res) => {
    await Simulation.findByIdAndDelete(req.params.id);
    stopSimulation(req.params.id);
    await cleanupOrphanSimulators();
    res.redirect('/');
});

// Iniciar simulaciones activas al arrancar el servidor
mongoose.connection.once('open', async () => {
    const active = await Simulation.find({ running: true });
    active.forEach(sim => startSimulation(sim));
});

app.listen(PORT, () => console.log(`🟢 Simulator running at http://localhost:${PORT}`));
