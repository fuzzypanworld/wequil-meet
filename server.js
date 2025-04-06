const socketIO = require("socket.io");
const express = require("express");
const path = require("path");
const http = require("http");
const app = express();

const config = require("./config");
const signallingServer = require("./signalling-server");

// Get PORT from env variable else assign 3000 for development
const PORT = process.env.PORT || config.PORT || 3000;
const server = http.createServer(app);

// Set views directory and engine
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Serve static files
app.use(express.static(path.join(__dirname, "www")));
app.use(express.static(path.join(__dirname, "assets")));

// Serve Vue.js and adapter files
app.get("/vue.global.prod.js", (req, res) => {
	res.sendFile(path.join(__dirname, "node_modules/vue/dist/vue.global.prod.js"));
});

app.get("/adapter-latest.js", (req, res) => {
	res.sendFile(path.join(__dirname, "node_modules/webrtc-adapter/out/adapter.js"));
});

// Configure Socket.IO with CORS for Vercel
const io = socketIO(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"],
		credentials: true
	},
	transports: ['websocket', 'polling'],
	path: '/socket.io'
});
io.sockets.on("connection", signallingServer);

// Add error handling for view rendering
const renderWithErrorHandling = (res, view, data) => {
	try {
		res.render(view, data);
	} catch (err) {
		console.error(`Error rendering ${view}:`, err);
		res.status(500).send('Internal Server Error');
	}
};

// Routes
app.get("/", (req, res) => {
	renderWithErrorHandling(res, "index", { page: "index", title: "A free video chat for the web." });
});

app.get("/faq", (req, res) => {
	renderWithErrorHandling(res, "faq", { page: "faq", title: "Frequently asked questions" });
});

app.get(["/privacy", "/legal", "/terms"], (req, res) => {
	renderWithErrorHandling(res, "privacy", { page: "privacy", title: "Privacy policy" });
});

app.get("/404", (req, res) => {
	renderWithErrorHandling(res, "404", { page: "404", title: "Page not found" });
});

app.get("/:channel", (req, res) => {
	const channel = req.params.channel;
	const channelRegex = /^([a-zA-Z0-9-]){1,100}$/;
	if (!channelRegex.test(channel)) {
		return renderWithErrorHandling(res, "invalid", { page: "invalid-channel", title: "Invalid channel" });
	}
	renderWithErrorHandling(res, "channel", { page: "channel", title: channel });
});

// 404 handler
app.use("/*", (req, res) => {
	renderWithErrorHandling(res, "404", { page: "404", title: "Page not found" });
});

// Error handling middleware
app.use((err, req, res, next) => {
	console.error('Server Error:', err);
	res.status(500).send('Internal Server Error');
});

// Start server
if (process.env.NODE_ENV !== 'production') {
	server.listen(PORT, () => {
		console.log(`Development server running on port ${PORT}`);
	});
}

module.exports = app;
