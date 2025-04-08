const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    path: '/socket.io/',
    transports: ['websocket', 'polling']
});

// Enable CORS
app.use(cors({
    origin: "*",
    credentials: true
}));

// Store active rooms
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', (roomId) => {
        console.log(`User ${socket.id} joining room: ${roomId}`);
        
        // Join the room
        socket.join(roomId);
        
        // Initialize room if it doesn't exist
        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: []
            };
        }
        
        // Add user to room
        rooms[roomId].users.push(socket.id);
        
        // Notify others in the room
        socket.to(roomId).emit('user-joined', socket.id);
    });

    socket.on('offer', (data) => {
        console.log(`Offer from ${socket.id} to ${data.to}`);
        socket.to(data.to).emit('offer', {
            offer: data.offer,
            from: socket.id
        });
    });

    socket.on('answer', (data) => {
        console.log(`Answer from ${socket.id} to ${data.to}`);
        socket.to(data.to).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        console.log(`ICE candidate from ${socket.id} to ${data.to}`);
        socket.to(data.to).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Remove user from all rooms
        Object.keys(rooms).forEach(roomId => {
            const index = rooms[roomId].users.indexOf(socket.id);
            if (index !== -1) {
                rooms[roomId].users.splice(index, 1);
                socket.to(roomId).emit('user-left', socket.id);
                
                // Clean up empty rooms
                if (rooms[roomId].users.length === 0) {
                    delete rooms[roomId];
                }
            }
        });
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
}); 