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
mongoose.connection.once('open', () => console.log('Connected to MongoDB'));

let simulators = {}; // Active simulators

function startSimulation(sim) {
    if (simulators[sim._id]) {
        console.warn(`[${sim.username}] Simulador previo detectado. Reiniciando...`);
        stopSimulation(sim._id);
    }

    console.log(`[${sim.username}] Iniciando nuevo simulador con intervalo ${sim.interval} ms...`);

    let ws;
    let sendInterval = null;
    let pingInterval = null;
    let reconnectTimeout = null;
    let shouldReconnect = true; // ← NUEVA BANDERA

    const connect = () => {
        ws = new WebSocket('wss://bio-data-production.up.railway.app');

        ws.on('open', () => {
            console.log(`[${sim.username}] WebSocket conectado`);
            ws.send(JSON.stringify({ username: sim.username }));

            sendInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    const temp = sim.fixed ? sim.temperature : (Math.random() * (sim.maxT - sim.minT) + sim.minT);
                    const hum = sim.fixed ? sim.humidity : (Math.random() * (sim.maxH - sim.minH) + sim.minH);
                    const ds = sim.fixed ? sim.dsTemperature : (Math.random() * (sim.maxDsT - sim.minDsT) + sim.minDsT);

                    const payload = {
                        username: sim.username,
                        dsTemperature: parseFloat(ds.toFixed(1)),
                        temperature: parseFloat(temp.toFixed(1)),
                        humidity: Math.round(hum),
                        doorStatus: sim.doorStatus || 'closed',
                        datetime: new Date().toISOString()
                    };

                    ws.send(JSON.stringify(payload));
                }
            }, sim.interval);

            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                }
            }, 25000);

            simulators[sim._id] = {
                ws,
                sendInterval,
                pingInterval,
                reconnectTimeout,
                username: sim.username,
                simId: sim._id.toString(),
                stopReconnect: () => { shouldReconnect = false; } // ← FUNCIÓN PARA DETENER
            };
        });

        ws.on('close', async () => {
            console.warn(`[${sim.username}] WebSocket cerrado`);

            clearInterval(sendInterval);
            clearInterval(pingInterval);
            clearTimeout(reconnectTimeout);

            if (!shouldReconnect) { // ← VERIFICAR BANDERA
                console.log(`[${sim.username}] Reconexión deshabilitada. No se reconecta.`);
                delete simulators[sim._id];
                return;
            }

            const stillExists = await Simulation.exists({ _id: sim._id });
            if (stillExists) {
                console.log(`[${sim.username}] Reintentando conexión en 5s...`);
                reconnectTimeout = setTimeout(connect, 5000);
            } else {
                console.log(`[${sim.username}] Simulador eliminado de DB. No se reconecta.`);
                delete simulators[sim._id];
            }
        });

        ws.on('error', err => console.error(`[${sim.username}] Error: ${err.message}`));
    };

    connect();
}

function stopSimulation(id) {
    console.log(`\nDeteniendo simulador ID: ${id}`);

    const sim = simulators[id];

    if (!sim) {
        console.log(`[${id}] No encontrado en memoria`);
        return;
    }

    // ← ACTIVAR LA BANDERA PARA NO RECONECTAR
    if (sim.stopReconnect) {
        sim.stopReconnect();
    }

    if (sim.sendInterval) clearInterval(sim.sendInterval);
    if (sim.pingInterval) clearInterval(sim.pingInterval);
    if (sim.reconnectTimeout) clearTimeout(sim.reconnectTimeout);

    if (sim.ws) {
        sim.ws.removeAllListeners('close');
        sim.ws.removeAllListeners('error');

        if (sim.ws.readyState === WebSocket.OPEN || sim.ws.readyState === WebSocket.CONNECTING) {
            sim.ws.close(1000, 'Simulator stopped');
            console.log(`[${sim.username}] WebSocket cerrado`);
        }
    }

    delete simulators[id];
    console.log(`[${sim.username}] Removido completamente\n`);
}

async function cleanupOrphanSimulators() {
    console.log('\nVerificando simuladores huerfanos...');

    const dbSims = await Simulation.find().select('_id username');
    const dbIds = dbSims.map(sim => sim._id.toString());

    console.log(`Simuladores en DB: ${dbIds.length}`);
    console.log(`Simuladores en memoria: ${Object.keys(simulators).length}`);

    // Eliminar simuladores en memoria que no estan en DB
    Object.keys(simulators).forEach(id => {
        if (!dbIds.includes(id)) {
            console.warn(`Simulador huerfano detectado y detenido: ${id}`);
            stopSimulation(id);
        }
    });

    // Iniciar simuladores en DB que no estan en memoria
    for (const dbSim of dbSims) {
        if (!simulators[dbSim._id.toString()]) {
            console.log(`Simulador en DB sin ejecutar: ${dbSim.username}. Iniciando...`);
            const fullSim = await Simulation.findById(dbSim._id);
            startSimulation(fullSim);
        }
    }

    console.log('Verificacion completada\n');
}

// Verificacion automatica cada 30 segundos
setInterval(async () => {
    await cleanupOrphanSimulators();
}, 30000);

// Routes
app.get('/', async (req, res) => {
    const devices = await Simulation.find();
    const activeCount = Object.keys(simulators).length;
    res.render('index', { devices, activeCount });
});

app.post('/add', async (req, res) => {
    const sim = new Simulation({
        username: req.body.username,
        minT: parseFloat(req.body.minT) || 0,
        maxT: parseFloat(req.body.maxT) || 0,
        minH: parseFloat(req.body.minH) || 0,
        maxH: parseFloat(req.body.maxH) || 0,
        minDsT: parseFloat(req.body.minDsT) || 0,
        maxDsT: parseFloat(req.body.maxDsT) || 0,
        fixed: req.body.fixed === 'on',
        temperature: parseFloat(req.body.temperature) || 0,
        humidity: parseFloat(req.body.humidity) || 0,
        dsTemperature: parseFloat(req.body.dsTemperature) || 0,
        doorStatus: req.body.doorStatus || 'closed',
        interval: parseInt(req.body.interval) || 2000,
        running: true
    });
    const saved = await sim.save();
    startSimulation(saved);
    await cleanupOrphanSimulators();
    res.redirect('/');
});

app.post('/delete/:id', async (req, res) => {
    const id = req.params.id;
    console.log(`\nEliminando simulador ID: ${id}`);

    // Primero detener el simulador
    stopSimulation(id);

    // Luego eliminar de la base de datos
    const deleted = await Simulation.findByIdAndDelete(id);
    if (deleted) {
        console.log(`Simulador ${deleted.username} eliminado de MongoDB`);
    }

    // Verificar limpieza
    await cleanupOrphanSimulators();

    res.redirect('/');
});

app.post('/delete-all', async (req, res) => {
    console.log('\nEliminando TODOS los simuladores...');

    const sims = await Simulation.find();
    for (const sim of sims) {
        stopSimulation(sim._id.toString());
    }

    await Simulation.deleteMany({});

    // Forzar limpieza completa
    simulators = {};

    console.log('Todos los simuladores eliminados\n');
    res.redirect('/');
});

app.post('/log-active', async (req, res) => {
    const activeIds = Object.keys(simulators);
    const dbCount = await Simulation.countDocuments();

    console.log('\n==== Estado de Simuladores ==== ');
    console.log(`Simuladores en MongoDB: ${dbCount}`);
    console.log(`Simuladores en memoria: ${activeIds.length}`);

    if (activeIds.length === 0) {
        console.log('No hay simuladores activos en memoria');
    } else {
        activeIds.forEach(id => {
            const sim = simulators[id];
            console.log(`\nID: ${id}`);
            console.log(`  Username: ${sim.username}`);
            console.log(`  WebSocket estado: ${sim?.ws?.readyState}`);
            console.log(`  sendInterval activo: ${!!sim.sendInterval}`);
            console.log(`  pingInterval activo: ${!!sim.pingInterval}`);
        });
    }
    console.log('========================================\n');

    res.status(200).send('OK');
});

app.post('/force-sync', async (req, res) => {
    console.log('\nForzando sincronizacion...');
    await cleanupOrphanSimulators();
    res.redirect('/');
});

// Al arrancar, iniciar simuladores activos
mongoose.connection.once('open', async () => {
    const active = await Simulation.find({ running: true });
    console.log(`\nIniciando ${active.length} simuladores al arrancar...`);
    active.forEach(sim => startSimulation(sim));
});

app.listen(PORT, () => console.log(`Simulator running at http://localhost:${PORT}`));
