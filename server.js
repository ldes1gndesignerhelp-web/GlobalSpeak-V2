const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Хранилище активных комнат и пользователей
const rooms = new Map(); // roomId -> { users: Map(userId -> userData) }

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('Новый пользователь подключился:', socket.id);

    // Создание новой комнаты
    socket.on('create-room', ({ username }) => {
        const roomId = uuidv4().substring(0, 6).toUpperCase();
        rooms.set(roomId, { 
            users: new Map(),
            createdAt: Date.now()
        });
        
        const userData = {
            id: socket.id,
            username: username,
            joinedAt: Date.now(),
            isSpeaking: false
        };
        
        rooms.get(roomId).users.set(socket.id, userData);
        socket.join(roomId);
        
        socket.emit('room-created', { 
            roomId, 
            user: userData 
        });
        
        console.log(`Комната ${roomId} создана пользователем ${username}`);
    });

    // Подключение к существующей комнате
    socket.on('join-room', ({ roomId, username }) => {
        const normalizedRoomId = roomId.toUpperCase();
        
        if (rooms.has(normalizedRoomId)) {
            const room = rooms.get(normalizedRoomId);
            
            // Проверяем, не заполнена ли комната (максимум 2 человека)
            if (room.users.size >= 2) {
                socket.emit('room-full');
                return;
            }
            
            const userData = {
                id: socket.id,
                username: username,
                joinedAt: Date.now(),
                isSpeaking: false
            };
            
            room.users.set(socket.id, userData);
            socket.join(normalizedRoomId);
            
            // Отправляем новому пользователю список всех участников
            const users = Array.from(room.users.values());
            socket.emit('room-joined', { 
                roomId: normalizedRoomId, 
                users,
                user: userData
            });
            
            // Уведомляем всех остальных о новом пользователе
            socket.to(normalizedRoomId).emit('user-connected', { 
                user: userData 
            });
            
            console.log(`Пользователь ${username} присоединился к комнате ${normalizedRoomId}`);
        } else {
            socket.emit('room-not-found');
        }
    });

    // Обработка статуса разговора
    socket.on('speaking-status', ({ isSpeaking }) => {
        // Обновляем статус пользователя во всех комнатах
        rooms.forEach((room, roomId) => {
            if (room.users.has(socket.id)) {
                const userData = room.users.get(socket.id);
                userData.isSpeaking = isSpeaking;
                
                // Отправляем обновленный статус всем в комнате
                io.to(roomId).emit('user-speaking', {
                    userId: socket.id,
                    isSpeaking: isSpeaking
                });
            }
        });
    });

    // Обработка WebRTC сигналов
    socket.on('offer', ({ to, offer }) => {
        io.to(to).emit('offer', { 
            from: socket.id, 
            offer,
            fromUsername: getUsername(socket.id)
        });
    });

    socket.on('answer', ({ to, answer }) => {
        io.to(to).emit('answer', { 
            from: socket.id, 
            answer,
            fromUsername: getUsername(socket.id)
        });
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        io.to(to).emit('ice-candidate', { 
            from: socket.id, 
            candidate,
            fromUsername: getUsername(socket.id)
        });
    });

    // Отключение пользователя
    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
        
        // Удаляем пользователя из всех комнат
        rooms.forEach((room, roomId) => {
            if (room.users.has(socket.id)) {
                const userData = room.users.get(socket.id);
                room.users.delete(socket.id);
                
                // Уведомляем остальных
                io.to(roomId).emit('user-disconnected', { 
                    userId: socket.id,
                    username: userData.username 
                });
                
                // Удаляем комнату, если в ней никого нет
                if (room.users.size === 0) {
                    rooms.delete(roomId);
                    console.log(`Комната ${roomId} удалена (пуста)`);
                }
            }
        });
    });

    // Получение имени пользователя по ID
    function getUsername(socketId) {
        for (const room of rooms.values()) {
            if (room.users.has(socketId)) {
                return room.users.get(socketId).username;
            }
        }
        return 'Unknown';
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});