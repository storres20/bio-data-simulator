// models/simulation.model.js
const mongoose = require('mongoose');

const simulationSchema = new mongoose.Schema({
    //id: { type: String, required: true }, // UUID
    username: { type: String, required: true },
    minT: Number,
    maxT: Number,
    minH: Number,
    maxH: Number,
    minDsT: Number,
    maxDsT: Number,
    fixed: { type: Boolean, default: false },
    temperature: Number,
    humidity: Number,
    dsTemperature: Number,
    interval: { type: Number, default: 2000 },
    running: { type: Boolean, default: true }
});

module.exports = mongoose.model('Simulation', simulationSchema);
