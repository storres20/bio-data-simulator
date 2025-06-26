# ESP8266 WebSocket Simulator - MHUTEMP

This is a Node.js-based web application to simulate ESP8266 devices sending real-time temperature and humidity data via WebSocket. It allows you to:

- Create, edit, stop, and delete simulated devices.
- Send randomized or fixed sensor data (DHT22 and DS18B20).
- Persist devices in a local JSON file (`devices.json`).
- View and control the simulation from a simple EJS web dashboard.

## 🚀 Features

- Simulates internal temperature (Temp.IN - DHT22), external temperature (Temp.OUT - DS18B20), and humidity (Hum.IN).
- Option to send fixed values or random values in a defined range.
- Sends data every X milliseconds via WebSocket to a configurable server.
- Data fields: `username`, `temperature`, `humidity`, `dsTemperature`, `datetime`.

## 📦 Requirements

- Node.js (v14 or higher recommended)
- pnpm

## 📁 Project Structure

```
esp-simulator/
├── index.js
├── data/
│   └── devices.json
├── views/
│   ├── index.ejs
│   └── edit.ejs
├── public/
│   └── (static assets if needed)
```

## 📥 Installation

```
pnpm install express ejs ws uuid
pnpm add -D nodemon
```

## 🧪 Run the Project

```
pnpm nodemon index.js
```

Then open http://localhost:3005


## ✨ Usage

- Go to the homepage.
- Fill out the form to create a simulated device.
- Choose between Fixed Mode or value ranges.
- Set the simulation interval in milliseconds.
- The device will immediately start sending data to the WebSocket server.
- Use Edit, Stop, or Delete options on each simulated device.
- All data is stored in data/devices.json and persists across restarts.


## 🛠️ Configuration
WebSocket server endpoint is hardcoded in index.js:

```
const ws = new WebSocket('wss://bio-data-production.up.railway.app');
```

Change it as needed.

## 📌 Deployment Note
This app writes to data/devices.json, so Vercel is not recommended. Use platforms like:

- Railway
- Render
- Glitch
- Your own VPS

## 📄 License
MIT — feel free to adapt it for your project.

## Made with ❤️ for simulating IoT systems like MHUTEMP.

- Let me know if you want to add badges, screenshots, or GitHub deployment instructions.
 
