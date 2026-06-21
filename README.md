# Gemini Radio PTT 📻

A custom client for the **Gemini Multimodal Live API** that implements a global Push-to-Talk (PTT) system with vintage military radio / walkie-talkie audio effects (Bandpass filter, Soft Distortion, Dynamic Compression, and White Noise).

This project features both a **Desktop Electron Application** (with global hotkeys) and a **Mobile-Optimized Web Application** designed to be served directly via **GitHub Pages**.

---

## 🌟 Features

*   **Multimodal Live API**: Low-latency, bidirectional streaming with Gemini.
*   **Tactical DSP Audio Pipeline**:
    *   **Bandpass Filter**: Restricts frequency range to a classic radio bandwidth (300 Hz - 2500 Hz).
    *   **Soft Distortion**: Adds warm analog saturation to the voice signal.
    *   **Dynamic Compression**: Normalizes and tightens the audio levels.
    *   **White Noise Injection**: Fades in walkie-talkie static squelch on transmission (TX) start/stop and reception (RX) transitions.
*   **Dual Mode Deployment**:
    *   **Desktop Client (Electron)**: Run locally with global key listeners to talk even while the window is in the background.
    *   **Mobile Demo (Web)**: Fully responsive, tactile interface for mobile browsers, deployed statically.

---

## 🚀 Quick Start (Local Electron App)

### 1. Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed.

### 2. Installation
Clone this repository and install dependencies:
```bash
npm install
```

### 3. Environment Setup
Create a `.env` file in the root directory:
```bash
copy .env.example .env
```
Open `.env` and fill in your Gemini API key:
```env
GEMINI_API_KEY="your_api_key_here"
```

### 4. Running the App
Start the Electron application (this compiles TypeScript and launches the app):
```bash
npm start
```
By default, the global PTT key is set to **Caps Lock** (or another key configured in the settings).

---

## 📱 Mobile Web Demo & GitHub Pages Deployment

The root `index.html` is configured as a standalone mobile-tactical web interface. Since it uses client-side TypeScript compiled to the `/dist` directory, you can deploy it to **GitHub Pages** as a static site.

### Deploying to GitHub Pages
1. Push this repository to your GitHub account (you can use the **GitHub Desktop** app).
2. On GitHub, navigate to your repository's **Settings** tab.
3. Click on **Pages** in the left sidebar.
4. Under **Build and deployment**, set the source to **Deploy from a branch**.
5. Select the **`main`** (or `master`) branch and set the folder to **`/ (root)`**.
6. Click **Save**.
7. Wait a minute for GitHub Actions to complete, then your page will be live at:
   `https://<your-username>.github.io/<your-repo-name>/`

### Accessing the Web App
Because GitHub Pages hosts static files, the app does not read your private server-side `.env` file. Instead, you supply your Gemini API key securely in the URL query string:

```
https://<your-username>.github.io/<your-repo-name>/?apiKey=YOUR_GEMINI_API_KEY
```

> [!IMPORTANT]
> Your API key is processed entirely inside your local browser to establish a direct WebSocket connection with Google's Gemini servers. It is **never** sent to any third-party servers.

---

## 📂 Project Structure

*   [`index.html`](file:///c:/Users/UTENTE/Desktop/USB/GitHub/gemini-radio-ptt/index.html): Entry point for the mobile-responsive web app.
*   [`src/common.ts`](file:///c:/Users/UTENTE/Desktop/USB/GitHub/gemini-radio-ptt/src/common.ts): The core shared DSP pipeline, audio downsampling, and WebSocket connection logic.
*   [`src/main.ts`](file:///c:/Users/UTENTE/Desktop/USB/GitHub/gemini-radio-ptt/src/main.ts): Electron main process (manages the window lifecycle and registers global PTT hotkeys).
*   [`src/renderer.ts`](file:///c:/Users/UTENTE/Desktop/USB/GitHub/gemini-radio-ptt/src/renderer.ts): Electron renderer process (handles UI binding and connects to local environment variables).
*   [`src/mobile.ts`](file:///c:/Users/UTENTE/Desktop/USB/GitHub/gemini-radio-ptt/src/mobile.ts): Handles web/mobile interactions, reads the API key from the query parameters, and drives the mobile tactical UI.
*   `dist/`: Output directory containing compiled JavaScript files ready for execution and deployment.

---

## 🛠️ Development & Building

If you make modifications to the source TS files in `/src`, compile them before committing:
```bash
npm run build
```
This runs `tsc` to compile and output the latest JS files to the `dist/` directory.

To run a simple local web server to test the mobile layout:
```bash
npm run mobile
```
Then navigate to `http://localhost:8080/?apiKey=YOUR_API_KEY`.

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
