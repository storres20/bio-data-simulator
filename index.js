require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const WebSocket = require('ws');

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

            //simulators[sim._id] = { ws, sendInterval, pingInterval };
            simulators[sim._id] = { ws, sendInterval, pingInterval, username: sim.username };

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
                sim.ws.close(); // ✅ cierre limpio
                console.log(`[${id}] 🔌 WebSocket cerrado limpiamente`);
            } catch (e) {
                console.error(`[${id}] ⚠️ Error al cerrar WebSocket: ${e.message}`);
            }
        }

        delete simulators[id];
        console.log(`[${id}] 🧹 Simulador detenido y removido de memoria`);
    } else {
        console.log(`[${id}] ⚠️ No se encontró simulador activo en memoria`);
    }
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

app.post('/delete/:id', async (req, res) => {
    await Simulation.findByIdAndDelete(req.params.id);
    stopSimulation(req.params.id);
    await cleanupOrphanSimulators();
    res.redirect('/');
});

// ✅ Ruta adicional: eliminar todos los simuladores activos
app.post('/delete-all', async (req, res) => {
    const sims = await Simulation.find();
    for (const sim of sims) {
        stopSimulation(sim._id);
    }
    await Simulation.deleteMany({});
    console.log('🗑️ Todos los simuladores eliminados');
    res.redirect('/');
});

app.post('/log-active', (req, res) => {
    const activeIds = Object.keys(simulators);

    console.log('\n📋 ==== Simuladores activos en memoria ==== ');
    if (activeIds.length === 0) {
        console.log('📭 No hay simuladores activos en memoria');
    } else {
        activeIds.forEach(id => {
            const sim = simulators[id];
            console.log(`🟢 ID: ${id}`);
            console.log(`   🔗 WebSocket URL: ${sim?.ws?.url || 'N/A'}`);
            console.log(`   ⏱️ Ping activo: ${!!sim.pingInterval}`);
            console.log(`   ⏰ Interval activo: ${!!sim.sendInterval}`);
            console.log(`   📡 Estado WS: ${sim?.ws?.readyState}`);
        });
    }
    console.log('========================================\n');

    res.status(200).send('OK');
});

// Al arrancar, iniciar simuladores activos
mongoose.connection.once('open', async () => {
    const active = await Simulation.find({ running: true });
    active.forEach(sim => startSimulation(sim));
});

app.listen(PORT, () => console.log(`🟢 Simulator running at http://localhost:${PORT}`));
