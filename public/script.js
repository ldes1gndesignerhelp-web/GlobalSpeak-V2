const socket = io();

// Код доступа
const ACCESS_CODE = 'hg-100UIRockaGaY';

let localStream;
let peerConnections = {};
let currentRoom = null;
let currentUser = null;
let isAudioEnabled = true;
let audioContext = null;
let analyser = null;
let microphone = null;
let animationFrame = null;
let speakingTimeout = null;

// DOM элементы
const accessScreen = document.getElementById('access-screen');
const joinScreen = document.getElementById('join-screen');
const callScreen = document.getElementById('call-screen');
const accessCodeInput = document.getElementById('access-code-input');
const submitAccessBtn = document.getElementById('submit-access-btn');
const accessError = document.getElementById('access-error');
const usernameInput = document.getElementById('username-input');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const roomIdInput = document.getElementById('room-id-input');
const roomIdDisplay = document.getElementById('room-id-display');
const copyRoomBtn = document.getElementById('copy-room-btn');
const toggleAudioBtn = document.getElementById('toggle-audio');
const leaveCallBtn = document.getElementById('leave-call');
const notification = document.getElementById('notification');
const notificationMessage = document.getElementById('notification-message');
const connectionStatus = document.getElementById('connection-status');

// Элементы для участников
const localTile = document.getElementById('local-participant-tile');
const remoteTile = document.getElementById('remote-participant-tile');
const localAvatarLarge = document.getElementById('local-avatar-large');
const remoteAvatarLarge = document.getElementById('remote-avatar-large');
const localNameDisplay = document.getElementById('local-name-display');
const remoteNameDisplay = document.getElementById('remote-name-display');

// Конфигурация STUN серверов
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Проверка сохраненного доступа при загрузке
document.addEventListener('DOMContentLoaded', () => {
    const hasAccess = localStorage.getItem('vox_access') === 'granted';
    
    if (hasAccess) {
        // Уже есть доступ - показываем экран входа в комнату
        accessScreen.classList.add('hidden');
        joinScreen.classList.remove('hidden');
    } else {
        // Нет доступа - показываем экран ввода кода
        accessScreen.classList.remove('hidden');
        joinScreen.classList.add('hidden');
    }
    
    callScreen.classList.add('hidden');
    
    // Активируем кнопки
    createRoomBtn.disabled = true;
    joinRoomBtn.disabled = true;
    
    // Очищаем поля
    usernameInput.value = '';
    roomIdInput.value = '';
    accessCodeInput.value = '';
});

// Ввод кода доступа по Enter
accessCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        submitAccessBtn.click();
    }
});

// Обработка ввода кода доступа
submitAccessBtn.addEventListener('click', () => {
    const code = accessCodeInput.value.trim();
    
    if (code === ACCESS_CODE) {
        // Правильный код - сохраняем доступ и переходим к входу
        localStorage.setItem('vox_access', 'granted');
        accessScreen.classList.add('hidden');
        joinScreen.classList.remove('hidden');
        accessError.classList.add('hidden');
        accessCodeInput.value = '';
        showNotification('Доступ разрешен', 'success');
    } else {
        // Неправильный код - показываем ошибку
        accessError.textContent = 'Неверный код доступа';
        accessError.classList.remove('hidden');
        accessCodeInput.value = '';
    }
});

// Валидация ввода имени и комнаты
usernameInput.addEventListener('input', () => {
    const username = usernameInput.value.trim();
    const hasUsername = username.length > 0;
    createRoomBtn.disabled = !hasUsername;
    
    const hasRoomId = roomIdInput.value.trim().length > 0;
    joinRoomBtn.disabled = !hasUsername || !hasRoomId;
});

roomIdInput.addEventListener('input', () => {
    const username = usernameInput.value.trim();
    const hasRoomId = roomIdInput.value.trim().length > 0;
    const hasUsername = username.length > 0;
    
    joinRoomBtn.disabled = !hasRoomId || !hasUsername;
    roomIdInput.value = roomIdInput.value.toUpperCase();
});

// Ввод по Enter
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !createRoomBtn.disabled) {
        createRoomBtn.click();
    }
});

roomIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !joinRoomBtn.disabled) {
        joinRoomBtn.click();
    }
});

// Показать уведомление
function showNotification(message, type = 'info') {
    notificationMessage.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    
    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}

// Получение первой буквы для аватара
function getInitials(username) {
    return username ? username.charAt(0).toUpperCase() : '?';
}

// Обновление статуса разговора
function updateSpeakingStatus(userId, isSpeaking) {
    if (userId === socket.id) {
        if (isSpeaking) {
            localTile.classList.add('speaking');
        } else {
            localTile.classList.remove('speaking');
        }
    } else {
        if (isSpeaking) {
            remoteTile.classList.add('speaking');
        } else {
            remoteTile.classList.remove('speaking');
        }
    }
}

// Настройка анализатора голоса
function setupVoiceActivityDetection(stream) {
    try {
        // Создаем аудио контекст, если его нет
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Создаем анализатор
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        
        // Подключаем микрофон к анализатору
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        let isSpeaking = false;
        
        function detectSpeaking() {
            if (!analyser) return;
            
            analyser.getByteFrequencyData(dataArray);
            
            // Вычисляем среднюю громкость
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;
            
            // Порог для определения разговора
            const threshold = 20;
            const currentlySpeaking = average > threshold;
            
            if (currentlySpeaking !== isSpeaking) {
                isSpeaking = currentlySpeaking;
                
                if (isSpeaking) {
                    // Начал говорить
                    socket.emit('speaking-status', { isSpeaking: true });
                    updateSpeakingStatus(socket.id, true);
                    
                    // Сбрасываем таймаут, если был
                    if (speakingTimeout) {
                        clearTimeout(speakingTimeout);
                        speakingTimeout = null;
                    }
                } else {
                    // Перестал говорить - добавляем задержку перед выключением
                    if (speakingTimeout) {
                        clearTimeout(speakingTimeout);
                    }
                    
                    speakingTimeout = setTimeout(() => {
                        socket.emit('speaking-status', { isSpeaking: false });
                        updateSpeakingStatus(socket.id, false);
                        speakingTimeout = null;
                    }, 200);
                }
            }
            
            // Продолжаем проверять
            animationFrame = requestAnimationFrame(detectSpeaking);
        }
        
        // Запускаем детектор
        detectSpeaking();
        
        return true;
    } catch (error) {
        console.error('Ошибка настройки аудио анализатора:', error);
        return false;
    }
}

// Получение доступа к микрофону
async function getLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
        
        console.log('✅ Микрофон получен');
        showNotification('Микрофон работает', 'success');
        
        return true;
    } catch (error) {
        console.error('❌ Ошибка доступа к микрофону:', error);
        showNotification('Не удалось получить доступ к микрофону', 'error');
        return false;
    }
}

// Обновление кнопки аудио
function updateAudioButton() {
    if (isAudioEnabled) {
        toggleAudioBtn.classList.remove('audio-off');
        toggleAudioBtn.classList.add('audio-on');
        toggleAudioBtn.title = 'Отключить микрофон';
    } else {
        toggleAudioBtn.classList.remove('audio-on');
        toggleAudioBtn.classList.add('audio-off');
        toggleAudioBtn.title = 'Включить микрофон';
    }
}

// Создание комнаты
createRoomBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    if (!username) {
        showNotification('Введите ваше имя', 'error');
        return;
    }
    
    const hasAudio = await getLocalStream();
    if (hasAudio) {
        socket.emit('create-room', { username });
        showNotification('Создание комнаты...', 'info');
    }
});

// Подключение к комнате
joinRoomBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim();
    
    if (!username) {
        showNotification('Введите ваше имя', 'error');
        return;
    }
    
    if (!roomId) {
        showNotification('Введите код комнаты', 'error');
        return;
    }
    
    const hasAudio = await getLocalStream();
    if (hasAudio) {
        socket.emit('join-room', { roomId, username });
        showNotification('Подключение к комнате...', 'info');
    }
});

// Создание peer connection
function createPeerConnection(targetUserId, isInitiator) {
    if (peerConnections[targetUserId]) return peerConnections[targetUserId];

    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections[targetUserId] = peerConnection;

    // Добавляем локальные аудио треки
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Обработка ICE кандидатов
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                to: targetUserId,
                candidate: event.candidate
            });
        }
    };

    // Обработка удаленного потока
    peerConnection.ontrack = (event) => {
        console.log('✅ Получен удаленный аудио поток');
    };

    // Если мы инициатор, создаем offer
    if (isInitiator) {
        setTimeout(() => {
            peerConnection.createOffer()
                .then(offer => peerConnection.setLocalDescription(offer))
                .then(() => {
                    socket.emit('offer', {
                        to: targetUserId,
                        offer: peerConnection.localDescription
                    });
                })
                .catch(error => console.error('❌ Ошибка создания offer:', error));
        }, 500);
    }

    return peerConnection;
}

// Обработка создания комнаты
socket.on('room-created', ({ roomId, user }) => {
    currentRoom = roomId;
    currentUser = user;
    
    roomIdDisplay.textContent = roomId;
    localNameDisplay.textContent = user.username;
    localAvatarLarge.textContent = getInitials(user.username);
    
    joinScreen.classList.add('hidden');
    callScreen.classList.remove('hidden');
    
    remoteNameDisplay.textContent = 'Ожидание...';
    remoteAvatarLarge.textContent = '?';
    remoteTile.classList.add('waiting');
    
    showNotification('Комната создана', 'success');
    
    // Настраиваем анализатор голоса после получения микрофона
    if (localStream) {
        setupVoiceActivityDetection(localStream);
    }
});

// Обработка подключения к комнате
socket.on('room-joined', ({ roomId, users, user }) => {
    currentRoom = roomId;
    currentUser = user;
    
    roomIdDisplay.textContent = roomId;
    localNameDisplay.textContent = user.username;
    localAvatarLarge.textContent = getInitials(user.username);
    
    joinScreen.classList.add('hidden');
    callScreen.classList.remove('hidden');
    
    const remoteUser = users.find(u => u.id !== socket.id);
    if (remoteUser) {
        remoteNameDisplay.textContent = remoteUser.username;
        remoteAvatarLarge.textContent = getInitials(remoteUser.username);
        remoteTile.classList.remove('waiting');
    }
    
    showNotification('Подключено к комнате', 'success');
    
    // Настраиваем анализатор голоса после получения микрофона
    if (localStream) {
        setupVoiceActivityDetection(localStream);
    }
    
    users.forEach(remoteUser => {
        if (remoteUser.id !== socket.id) {
            createPeerConnection(remoteUser.id, true);
        }
    });
});

// Обработка подключения нового пользователя
socket.on('user-connected', ({ user }) => {
    remoteNameDisplay.textContent = user.username;
    remoteAvatarLarge.textContent = getInitials(user.username);
    remoteTile.classList.remove('waiting');
    
    createPeerConnection(user.id, false);
    showNotification(`${user.username} подключился`, 'success');
});

// Обработка статуса разговора
socket.on('user-speaking', ({ userId, isSpeaking }) => {
    updateSpeakingStatus(userId, isSpeaking);
});

// Обработка WebRTC сигналов
socket.on('offer', async ({ from, offer }) => {
    const peerConnection = createPeerConnection(from, false);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('answer', {
        to: from,
        answer: peerConnection.localDescription
    });
});

socket.on('answer', ({ from, answer }) => {
    const peerConnection = peerConnections[from];
    if (peerConnection) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('ice-candidate', ({ from, candidate }) => {
    const peerConnection = peerConnections[from];
    if (peerConnection) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

// Комната заполнена
socket.on('room-full', () => {
    showNotification('Комната уже заполнена (максимум 2 человека)', 'error');
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
});

// Отключение пользователя
socket.on('user-disconnected', ({ userId, username }) => {
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }
    
    remoteNameDisplay.textContent = 'Ожидание...';
    remoteAvatarLarge.textContent = '?';
    remoteTile.classList.remove('speaking');
    remoteTile.classList.add('waiting');
    
    showNotification(`${username} покинул комнату`, 'info');
});

// Комната не найдена
socket.on('room-not-found', () => {
    showNotification('Комната не найдена', 'error');
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
});

// Копирование ID комнаты
copyRoomBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoom);
    copyRoomBtn.classList.add('copied');
    showNotification('Код скопирован', 'success');
    setTimeout(() => {
        copyRoomBtn.classList.remove('copied');
    }, 1000);
});

// Управление аудио
toggleAudioBtn.addEventListener('click', () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            isAudioEnabled = !isAudioEnabled;
            audioTrack.enabled = isAudioEnabled;
            updateAudioButton();
            
            showNotification(
                isAudioEnabled ? 'Микрофон включен' : 'Микрофон отключен',
                'info'
            );
            
            // Если микрофон отключен, убираем индикатор разговора
            if (!isAudioEnabled) {
                socket.emit('speaking-status', { isSpeaking: false });
                updateSpeakingStatus(socket.id, false);
            }
        }
    }
});

// Выход из звонка
leaveCallBtn.addEventListener('click', () => {
    // Останавливаем анализ голоса
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
    
    if (speakingTimeout) {
        clearTimeout(speakingTimeout);
        speakingTimeout = null;
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    // Закрываем все peer connections
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    // Останавливаем локальный поток
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Сбрасываем интерфейс
    remoteNameDisplay.textContent = 'Ожидание...';
    remoteAvatarLarge.textContent = '?';
    remoteTile.classList.remove('speaking', 'waiting');
    remoteTile.classList.add('waiting');
    localTile.classList.remove('speaking');
    
    // Возвращаемся на экран входа в комнату
    callScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');
    
    showNotification('Звонок завершен', 'info');
    
    // Очищаем поля
    roomIdInput.value = '';
});

// Обработка ошибок соединения
socket.on('connect_error', () => {
    showNotification('Ошибка подключения к серверу', 'error');
    connectionStatus.innerHTML = `
        <div class="status-dot" style="background: var(--accent-danger);"></div>
        <span>Отключено</span>
    `;
});

socket.on('disconnect', () => {
    connectionStatus.innerHTML = `
        <div class="status-dot" style="background: var(--accent-danger);"></div>
        <span>Отключено</span>
    `;
    showNotification('Потеряно соединение с сервером', 'error');
});

socket.on('reconnect', () => {
    connectionStatus.innerHTML = `
        <div class="status-dot connected"></div>
        <span>Подключено</span>
    `;
    showNotification('Соединение восстановлено', 'success');
});

// Очистка доступа (для тестирования можно добавить в консоль)
// localStorage.removeItem('vox_access');