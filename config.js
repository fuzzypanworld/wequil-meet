module.exports = {
	NODE_ENV: process.env.NODE_ENV,
	PORT: process.env.PORT || 3000,
	CORS_ORIGIN: "https://wequil-meet.vercel.app:*,http://localhost:3000*",
	SIGNALING_SERVER: process.env.SIGNALING_SERVER
};
