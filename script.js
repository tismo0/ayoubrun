document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const startButton = document.getElementById('startButton');
    const pauseButton = document.getElementById('pauseButton');
    const statusMessage = document.getElementById('statusMessage');
    const powerupStatus = document.getElementById('powerupStatus');
    const scoreEl = document.getElementById('score');
    const highScoreEl = document.getElementById('highScore');
    const overlay = document.getElementById('gameOverlay');
    const jumpButton = document.getElementById('jumpButton');
    const dashButton = document.getElementById('dashButton');
    const yearPlaceholder = document.getElementById('currentYear');

    if (!canvas || !canvas.getContext) {
        return;
    }

    if (yearPlaceholder) {
        yearPlaceholder.textContent = new Date().getFullYear();
    }

    const ctx = canvas.getContext('2d');

    const GROUND_LEVEL = canvas.height - 62;
    const GRAVITY = 2050;
    const FALL_GRAVITY = 3100;
    const JUMP_FORCE = 800;
    const DASH_DURATION = 0.10;
    const BASE_SPEED = 6.2;
    const COYOTE_TIME = 0.30;
    const JUMP_BUFFER = 0.14;

    const POWERUPS = {
        shield: { label: 'Bouclier', color: '#38bdf8', duration: 8 },
        boost: { label: 'Hyper boost', color: '#f472b6', duration: 6 },
        slow: { label: 'Temps ralenti', color: '#bef264', duration: 5 }
    };

    const WEATHER_TYPES = ['clair', 'pluie', 'orage', 'neons'];

    const STORAGE_KEYS = {
        playerId: 'astrarunPlayerId',
        playerIp: 'astrarunPlayerIp',
        highScores: 'astrarunHighScores'
    };

    const loadScoresMap = () => {
        const raw = localStorage.getItem(STORAGE_KEYS.highScores);
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            return typeof parsed === 'object' && parsed ? parsed : {};
        } catch {
            return {};
        }
    };

    const persistScoresMap = (map) => {
        localStorage.setItem(STORAGE_KEYS.highScores, JSON.stringify(map));
    };

    const getOrCreatePlayerId = () => {
        const existing = localStorage.getItem(STORAGE_KEYS.playerId);
        if (existing) return existing;
        const fallback = `player-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const generated = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : fallback;
        localStorage.setItem(STORAGE_KEYS.playerId, generated);
        return generated;
    };

    const playerProfile = {
        id: getOrCreatePlayerId(),
        ip: localStorage.getItem(STORAGE_KEYS.playerIp) || null
    };

    const getProfileKeys = () => {
        const keys = [`id:${playerProfile.id}`];
        if (playerProfile.ip) {
            keys.push(`ip:${playerProfile.ip}`);
        }
        return keys;
    };

    const loadHighScore = () => {
        const map = loadScoresMap();
        return getProfileKeys().reduce((best, key) => {
            const value = Number(map[key] ?? 0);
            return Number.isFinite(value) && value > best ? value : best;
        }, 0);
    };

    const saveHighScore = (value) => {
        const map = loadScoresMap();
        getProfileKeys().forEach((key) => {
            map[key] = Math.max(value, Number(map[key] ?? 0));
        });
        persistScoresMap(map);
    };

    const player = {
        x: 110,
        y: GROUND_LEVEL,
        width: 52,
        height: 62,
        velocityY: 0,
        dashTimer: 0,
        dashActive: false,
        isJumping: false,
        shielded: false,
        coyoteTimer: COYOTE_TIME,
        jumpBufferTimer: 0,
        get hitbox() {
            const height = this.dashTimer > 0 ? this.height * 0.55 : this.height;
            const offsetY = this.dashTimer > 0 ? this.height - height : 0;
            return {
                x: this.x + 6,
                y: this.y - height + offsetY,
                width: this.width - 12,
                height
            };
        }
    };

    const gameState = {
        running: false,
        paused: false,
        lastTimestamp: 0,
        speed: BASE_SPEED,
        slowFactor: 1,
        score: 0,
        highScore: loadHighScore(),
        scoreMultiplier: 1,
        obstacles: [],
        powerups: [],
        particles: [],
        obstacleTimer: 0,
        powerupTimer: 0,
        dayCycle: 0,
        weather: 'clair',
        weatherTimer: 0,
        activePowerup: null,
        message: 'Appuie sur Lancer pour démarrer',
        allowInput: true,
        animationFrame: null,
        aerialCooldown: 0
    };

    const resetPlayer = () => {
        player.y = GROUND_LEVEL;
        player.velocityY = 0;
        player.dashTimer = 0;
        player.dashActive = false;
        player.isJumping = false;
        player.shielded = false;
        player.coyoteTimer = COYOTE_TIME;
        player.jumpBufferTimer = 0;
    };

    const resetGame = () => {
        resetPlayer();
        gameState.speed = BASE_SPEED;
        gameState.slowFactor = 1;
        gameState.score = 0;
        gameState.obstacles = [];
        gameState.powerups = [];
        gameState.particles = [];
        gameState.obstacleTimer = 0.8;
        gameState.powerupTimer = 6;
        gameState.dayCycle = 0;
        gameState.weather = 'clair';
        gameState.weatherTimer = 10;
        gameState.activePowerup = null;
        gameState.scoreMultiplier = 1;
        overlay.textContent = '';
        updateStatus('Course en préparation...');
        updatePowerup('Aucun power-up actif');
        updateScoreUI();
        generateWeatherParticles();
        gameState.aerialCooldown = 0;
    };

    const updateStatus = (message) => {
        gameState.message = message;
        if (statusMessage) {
            statusMessage.textContent = message;
        }
    };

    const updatePowerup = (message) => {
        if (powerupStatus) {
            powerupStatus.textContent = message;
        }
    };

    const updateScoreUI = () => {
        const score = Math.floor(gameState.score);
        if (scoreEl) scoreEl.textContent = score.toString().padStart(5, '0');
        if (highScoreEl) highScoreEl.textContent = gameState.highScore.toString().padStart(5, '0');
    };

    const soundBank = {
        jump: new Audio('jump.mp3'),
        highscore: new Audio('allahakbar.mp3'),
        gameover: new Audio('assets/audio/gameover.mp3')
    };

    const playSound = (name) => {
        const audio = soundBank[name];
        if (!audio) return;
        try {
            audio.currentTime = 0;
            const playPromise = audio.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {});
            }
        } catch (error) {
            // Ignore autoplay restrictions
        }
    };

    const ensureIpLinkedHighScore = () => {
        const map = loadScoresMap();
        const keys = getProfileKeys();
        let best = Math.max(gameState.highScore, 0);
        keys.forEach((key) => {
            const value = Number(map[key] ?? 0);
            if (Number.isFinite(value) && value > best) {
                best = value;
            }
        });
        keys.forEach((key) => {
            map[key] = best;
        });
        persistScoresMap(map);
        if (best !== gameState.highScore) {
            gameState.highScore = best;
            updateScoreUI();
        }
    };

    const rectsOverlap = (a, b) => (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );

    const spawnObstacle = () => {
        const allowAerial = gameState.score > 450 || gameState.speed > 8.5;
        const aerialChance = allowAerial ? Math.min(0.12 + gameState.speed / 45, 0.5) : 0;
        const canSpawnAerial = gameState.aerialCooldown <= 0 && Math.random() < aerialChance;
        const spawnAerial = canSpawnAerial;
        const width = spawnAerial ? 72 : 46 + Math.random() * 22;
        const height = spawnAerial ? 42 : 60 + Math.random() * 28;
        const yBase = GROUND_LEVEL;
        const y = spawnAerial ? yBase - 44 : yBase;
        const variant = spawnAerial
            ? (Math.random() > 0.55 ? 'ptero' : 'drone')
            : (Math.random() > 0.35 ? 'cactus' : 'chair');

        gameState.obstacles.push({
            x: canvas.width + width,
            y,
            width,
            height,
            speedOffset: Math.random() * 1.2,
            type: spawnAerial ? 'drone' : 'cactus',
            variant
        });

        if (spawnAerial) {
            gameState.aerialCooldown = 1.8 - Math.min(0.8, gameState.speed / 14);
        }
    };

    const spawnPowerup = () => {
        const keys = Object.keys(POWERUPS);
        const type = keys[Math.floor(Math.random() * keys.length)];
        gameState.powerups.push({
            x: canvas.width + 40,
            y: GROUND_LEVEL - 80 - Math.random() * 40,
            width: 36,
            height: 36,
            type
        });
    };

    const clearPowerupEffects = () => {
        gameState.activePowerup = null;
        gameState.scoreMultiplier = 1;
        gameState.slowFactor = 1;
        player.shielded = false;
        updatePowerup('Aucun power-up actif');
    };

    const activatePowerup = (type) => {
        const config = POWERUPS[type];
        if (!config) return;

        gameState.activePowerup = { type, remaining: config.duration };
        switch (type) {
            case 'shield':
                player.shielded = true;
                updatePowerup(`${config.label} actif (${config.duration}s)`);
                updateStatus('Bouclier activé — Aucun obstacle ne te stoppe !');
                break;
            case 'boost':
                gameState.scoreMultiplier = 1.8;
                updatePowerup(`${config.label} — Score x1.8`);
                updateStatus('Hyper boost ! Score démultiplié.');
                break;
            case 'slow':
                gameState.slowFactor = 0.62;
                updatePowerup(`${config.label} — Objets ralentis`);
                updateStatus('Temps ralenti : profite pour planifier tes sauts.');
                break;
            default:
                break;
        }
    };

    const generateWeatherParticles = () => {
        gameState.particles = [];
        const count = gameState.weather === 'clair' ? 12 : 60;
        for (let i = 0; i < count; i += 1) {
            gameState.particles.push(createParticle());
        }
    };

    const createParticle = () => {
        switch (gameState.weather) {
            case 'pluie':
                return {
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    speedY: 600 + Math.random() * 300,
                    length: 16 + Math.random() * 12,
                    width: 2,
                    color: 'rgba(110, 231, 255, 0.6)'
                };
            case 'orage':
                return {
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height * 0.6,
                    speedX: -40 - Math.random() * 80,
                    speedY: 80 + Math.random() * 100,
                    radius: 1.2 + Math.random() * 2,
                    color: 'rgba(250, 204, 21, 0.8)'
                };
            case 'neons':
                return {
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    speedX: -30 - Math.random() * 50,
                    radius: 2 + Math.random() * 2,
                    color: Math.random() > 0.5 ? 'rgba(244, 114, 182, 0.9)' : 'rgba(56, 189, 248, 0.9)'
                };
            default:
                return {
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height * 0.4,
                    radius: 1 + Math.random() * 1,
                    color: 'rgba(226, 232, 240, 0.45)'
                };
        }
    };

    const changeWeather = () => {
        const nextWeather = WEATHER_TYPES[Math.floor(Math.random() * WEATHER_TYPES.length)];
        gameState.weather = nextWeather;
        gameState.weatherTimer = 12 + Math.random() * 10;
        generateWeatherParticles();
    };

    const requestJump = () => {
        player.jumpBufferTimer = JUMP_BUFFER;
    };

    const handleJump = () => {
        if (!gameState.running || gameState.paused) return;
        requestJump();
    };

    const handleDashStart = () => {
        if (!gameState.running || gameState.paused) return;
        player.dashActive = true;
        player.dashTimer = DASH_DURATION;
    };

    const handleDashEnd = () => {
        player.dashActive = false;
    };

    const updatePlayer = (delta) => {
        const onGround = player.y >= GROUND_LEVEL - 1;

        if (onGround) {
            player.coyoteTimer = COYOTE_TIME;
            player.isJumping = false;
        } else {
            player.coyoteTimer = Math.max(player.coyoteTimer - delta, 0);
        }

        if (player.jumpBufferTimer > 0) {
            player.jumpBufferTimer = Math.max(player.jumpBufferTimer - delta, 0);
        }

        if (player.jumpBufferTimer > 0 && player.coyoteTimer > 0) {
            player.velocityY = -JUMP_FORCE;
            player.isJumping = true;
            player.coyoteTimer = 0;
            player.jumpBufferTimer = 0;
            playSound('jump');
        }

        const gravityForce = player.velocityY < 0 ? GRAVITY : FALL_GRAVITY;
        player.velocityY += gravityForce * delta;
        player.y += player.velocityY * delta;

        if (player.y >= GROUND_LEVEL) {
            player.y = GROUND_LEVEL;
            player.velocityY = 0;
            player.isJumping = false;
            player.coyoteTimer = COYOTE_TIME;
        }

        if (player.dashActive) {
            player.dashTimer = DASH_DURATION;
        } else if (player.dashTimer > 0) {
            player.dashTimer -= delta;
            if (player.dashTimer <= 0) {
                player.dashTimer = 0;
            }
        }
    };

    const updateObstacles = (delta) => {
        const speed = (gameState.speed + 1) * gameState.slowFactor;

        gameState.obstacles = gameState.obstacles.filter((obstacle) => {
            obstacle.x -= speed * 60 * delta + obstacle.speedOffset;
            if (obstacle.x + obstacle.width < 0) {
                return false;
            }

            const obstacleHitbox = {
                x: obstacle.x + 4,
                y: obstacle.type === 'drone' ? obstacle.y - obstacle.height : obstacle.y - obstacle.height,
                width: obstacle.width - 8,
                height: obstacle.height
            };

            if (rectsOverlap(player.hitbox, obstacleHitbox)) {
                if (player.shielded) {
                    player.shielded = false;
                    gameState.obstacles.splice(gameState.obstacles.indexOf(obstacle), 1);
                    clearPowerupEffects();
                    updateStatus('Bouclier absorbé, continue !');
                    return false;
                }
                endGame();
                return false;
            }

            return true;
        });
    };

    const updatePowerups = (delta) => {
        const speed = (gameState.speed + 0.5) * gameState.slowFactor;
        gameState.powerups = gameState.powerups.filter((item) => {
            item.x -= speed * 55 * delta;
            if (item.x + item.width < 0) return false;

            if (rectsOverlap(player.hitbox, item)) {
                activatePowerup(item.type);
                return false;
            }
            return true;
        });

        if (gameState.activePowerup) {
            gameState.activePowerup.remaining -= delta;
            if (gameState.activePowerup.remaining <= 0) {
                clearPowerupEffects();
            } else {
                const config = POWERUPS[gameState.activePowerup.type];
                if (config) {
                    const remaining = Math.ceil(gameState.activePowerup.remaining);
                    updatePowerup(`${config.label} — ${remaining}s restants`);
                }
            }
        }
    };

    const updateParticles = (delta) => {
        gameState.particles.forEach((particle) => {
            if (gameState.weather === 'pluie') {
                particle.y += particle.speedY * delta;
                if (particle.y > canvas.height) {
                    particle.y = -particle.length;
                    particle.x = Math.random() * canvas.width;
                }
            } else if (gameState.weather === 'orage') {
                particle.x += particle.speedX * delta;
                particle.y += particle.speedY * delta;
                if (particle.x < 0) particle.x = canvas.width;
                if (particle.y > canvas.height * 0.7) particle.y = Math.random() * canvas.height * 0.4;
            } else if (gameState.weather === 'neons') {
                particle.x += particle.speedX * delta;
                if (particle.x < -particle.radius) {
                    particle.x = canvas.width + particle.radius;
                    particle.y = Math.random() * canvas.height;
                }
            } else {
                particle.y += 12 * delta;
                if (particle.y > canvas.height * 0.5) {
                    particle.y = Math.random() * canvas.height * 0.4;
                }
            }
        });
    };

    const updateGame = (delta) => {
        gameState.speed += delta * 0.18;
        gameState.score += delta * 100 * gameState.speed * gameState.scoreMultiplier;
        updateScoreUI();

        updatePlayer(delta);
        updateObstacles(delta);
        updatePowerups(delta);
        updateParticles(delta);

        gameState.aerialCooldown = Math.max(0, gameState.aerialCooldown - delta);

        gameState.obstacleTimer -= delta;
        if (gameState.obstacleTimer <= 0) {
            spawnObstacle();
            gameState.obstacleTimer = 0.9 - Math.min(0.5, gameState.speed / 60) + Math.random() * 0.6;
        }

        gameState.powerupTimer -= delta;
        if (gameState.powerupTimer <= 0) {
            spawnPowerup();
            gameState.powerupTimer = 9 + Math.random() * 6;
        }

        gameState.dayCycle += delta * 0.35;
        gameState.weatherTimer -= delta;
        if (gameState.weatherTimer <= 0) {
            changeWeather();
        }
    };

    const drawBackground = () => {
        const cycle = (Math.sin(gameState.dayCycle) + 1) / 2;
        const topColor = `rgba(${Math.floor(12 + 120 * cycle)}, ${Math.floor(22 + 140 * cycle)}, ${Math.floor(40 + 140 * cycle)}, 1)`;
        const bottomColor = `rgba(${Math.floor(2 + 40 * cycle)}, ${Math.floor(6 + 80 * cycle)}, ${Math.floor(24 + 90 * cycle)}, 1)`;
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, topColor);
        gradient.addColorStop(1, bottomColor);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.fillRect(0, GROUND_LEVEL + 4, canvas.width, canvas.height - GROUND_LEVEL - 4);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(0, GROUND_LEVEL + 8, canvas.width, canvas.height - GROUND_LEVEL - 8);
    };

    const drawPlayer = () => {
        ctx.save();
        ctx.translate(player.x, player.y);

        const effectiveHeight = player.dashTimer > 0 ? player.height * 0.55 : player.height;

        if (player.shielded) {
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.ellipse(player.width / 2, -effectiveHeight / 2, player.width / 1.6, effectiveHeight / 1.4, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Tail
        ctx.fillStyle = '#0ea5e9';
        ctx.beginPath();
        ctx.moveTo(player.width * 0.1, -effectiveHeight * 0.55);
        ctx.lineTo(-player.width * 0.45, -effectiveHeight * 0.4);
        ctx.lineTo(player.width * 0.08, -effectiveHeight * 0.2);
        ctx.closePath();
        ctx.fill();

        // Body
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.roundRect(0, -effectiveHeight, player.width, effectiveHeight, 14);
        ctx.fill();

        // Belly highlight
        ctx.fillStyle = '#e0f2fe';
        ctx.beginPath();
        ctx.roundRect(player.width * 0.45, -effectiveHeight * 0.9, player.width * 0.35, effectiveHeight * 0.6, 12);
        ctx.fill();

        // Head
        ctx.fillStyle = '#38bdf8';
        const headHeight = effectiveHeight * 0.45;
        ctx.beginPath();
        ctx.roundRect(player.width * 0.55, -effectiveHeight - headHeight * 0.4, player.width * 0.5, headHeight, 12);
        ctx.fill();

        // Eye
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(player.width * 0.92, -effectiveHeight + headHeight * 0.1, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(player.width * 0.95, -effectiveHeight + headHeight * 0.03, 2, 0, Math.PI * 2);
        ctx.fill();

        // Teeth
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(player.width * 0.58, -effectiveHeight + headHeight * 0.35);
        ctx.lineTo(player.width * 0.7, -effectiveHeight + headHeight * 0.48);
        ctx.lineTo(player.width * 0.82, -effectiveHeight + headHeight * 0.35);
        ctx.closePath();
        ctx.fill();

        // Legs
        const legHeight = player.dashTimer > 0 ? effectiveHeight * 0.25 : effectiveHeight * 0.4;
        ctx.fillStyle = '#0ea5e9';
        ctx.beginPath();
        ctx.roundRect(player.width * 0.15, -legHeight, player.width * 0.18, legHeight, 8);
        ctx.roundRect(player.width * 0.48, -legHeight, player.width * 0.18, legHeight, 8);
        ctx.fill();

        ctx.restore();
    };

    const drawGroundObstacle = (obstacle) => {
        ctx.save();
        const baseY = obstacle.y;
        const topY = baseY - obstacle.height;
        ctx.translate(obstacle.x, baseY);

        if (obstacle.variant === 'chair') {
            ctx.fillStyle = '#a855f7';
            ctx.fillRect(0, -obstacle.height * 0.65, obstacle.width * 0.65, obstacle.height * 0.65);
            ctx.fillStyle = '#7c3aed';
            ctx.fillRect(0, -obstacle.height * 0.45, obstacle.width * 0.7, obstacle.height * 0.18);
            ctx.fillRect(obstacle.width * 0.08, -obstacle.height * 0.12, obstacle.width * 0.12, obstacle.height * 0.12);
            ctx.fillRect(obstacle.width * 0.45, -obstacle.height * 0.12, obstacle.width * 0.12, obstacle.height * 0.12);
        } else {
            // Cactus variant
            ctx.fillStyle = '#22c55e';
            ctx.beginPath();
            ctx.roundRect(obstacle.width * 0.25, -obstacle.height, obstacle.width * 0.5, obstacle.height, 18);
            ctx.fill();

            ctx.beginPath();
            ctx.roundRect(obstacle.width * 0.05, -obstacle.height * 0.55, obstacle.width * 0.28, obstacle.height * 0.5, 12);
            ctx.roundRect(obstacle.width * 0.62, -obstacle.height * 0.7, obstacle.width * 0.26, obstacle.height * 0.6, 12);
            ctx.fillStyle = '#16a34a';
            ctx.fill();

            ctx.fillStyle = '#bbf7d0';
            for (let i = 0; i < 6; i += 1) {
                const offsetY = -obstacle.height * 0.15 * i;
                ctx.fillRect(obstacle.width * 0.45, offsetY - obstacle.height + 6, 3, 8);
            }
        }

        ctx.restore();
    };

    const drawAerialObstacle = (obstacle) => {
        ctx.save();
        const topY = obstacle.y - obstacle.height;
        ctx.translate(obstacle.x, topY);

        if (obstacle.variant === 'ptero') {
            const bodyColor = '#f472b6';
            const wingColor = '#fb7185';
            ctx.fillStyle = wingColor;
            ctx.beginPath();
            ctx.moveTo(0, obstacle.height * 0.6);
            ctx.quadraticCurveTo(obstacle.width * 0.5, obstacle.height * 1.1, obstacle.width, obstacle.height * 0.6);
            ctx.quadraticCurveTo(obstacle.width * 0.52, obstacle.height * 0.1, 0, obstacle.height * 0.6);
            ctx.fill();

            ctx.fillStyle = bodyColor;
            ctx.beginPath();
            ctx.roundRect(obstacle.width * 0.38, obstacle.height * 0.35, obstacle.width * 0.28, obstacle.height * 0.6, 12);
            ctx.fill();

            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(obstacle.width * 0.78, obstacle.height * 0.55, 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#fb7185';
            ctx.beginPath();
            ctx.moveTo(obstacle.width * 0.32, obstacle.height * 0.6);
            ctx.lineTo(obstacle.width * 0.15, obstacle.height * 0.8);
            ctx.lineTo(obstacle.width * 0.35, obstacle.height * 0.75);
            ctx.closePath();
            ctx.fill();
        } else {
            // Futuristic drone-bird hybrid
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.roundRect(obstacle.width * 0.2, obstacle.height * 0.25, obstacle.width * 0.6, obstacle.height * 0.5, 16);
            ctx.fill();

            ctx.fillStyle = '#fde68a';
            ctx.beginPath();
            ctx.roundRect(obstacle.width * 0.55, obstacle.height * 0.35, obstacle.width * 0.28, obstacle.height * 0.3, 10);
            ctx.fill();

            ctx.fillStyle = 'rgba(250, 204, 21, 0.65)';
            ctx.beginPath();
            ctx.moveTo(0, obstacle.height * 0.5);
            ctx.lineTo(obstacle.width * 0.2, obstacle.height * 0.35);
            ctx.lineTo(obstacle.width * 0.2, obstacle.height * 0.65);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(obstacle.width, obstacle.height * 0.5);
            ctx.lineTo(obstacle.width * 0.8, obstacle.height * 0.35);
            ctx.lineTo(obstacle.width * 0.8, obstacle.height * 0.65);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#1e293b';
            ctx.beginPath();
            ctx.arc(obstacle.width * 0.7, obstacle.height * 0.5, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    };

    const drawObstacles = () => {
        gameState.obstacles.forEach((obstacle) => {
            if (obstacle.type === 'drone') {
                drawAerialObstacle(obstacle);
            } else {
                drawGroundObstacle(obstacle);
            }
        });
    };

    const drawPowerups = () => {
        gameState.powerups.forEach((item) => {
            const config = POWERUPS[item.type];
            ctx.fillStyle = config?.color ?? '#22d3ee';
            ctx.beginPath();
            ctx.arc(item.x + item.width / 2, item.y - item.height / 2, item.width / 2, 0, Math.PI * 2);
            ctx.fill();
        });
    };

    const drawParticles = () => {
        gameState.particles.forEach((particle) => {
            ctx.fillStyle = particle.color;
            if (particle.length) {
                ctx.fillRect(particle.x, particle.y, particle.width, particle.length);
            } else {
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.radius ?? 1.2, 0, Math.PI * 2);
                ctx.fill();
            }
        });
    };

    const drawGame = () => {
        drawBackground();
        drawParticles();
        drawObstacles();
        drawPowerups();
        drawPlayer();
    };

    const loop = (timestamp) => {
        if (!gameState.running || gameState.paused) {
            return;
        }

        if (!gameState.lastTimestamp) {
            gameState.lastTimestamp = timestamp;
        }

        const delta = Math.min((timestamp - gameState.lastTimestamp) / 1000, 0.035);
        gameState.lastTimestamp = timestamp;

        updateGame(delta);
        drawGame();

        gameState.animationFrame = requestAnimationFrame(loop);
    };

    const endGame = () => {
        gameState.running = false;
        cancelAnimationFrame(gameState.animationFrame);
        updateStatus('Collision ! Appuie sur Lancer pour retenter.');
        overlay.textContent = 'GAME OVER';
        clearPowerupEffects();
        playSound('gameover');
        if (gameState.score > gameState.highScore) {
            gameState.highScore = Math.floor(gameState.score);
            saveHighScore(gameState.highScore);
            updateScoreUI();
            updateStatus('Nouveau record ! Appuie sur Lancer pour recommencer.');
            playSound('highscore');
        }
    };

    const startGame = () => {
        cancelAnimationFrame(gameState.animationFrame);
        resetGame();
        gameState.running = true;
        gameState.paused = false;
        gameState.lastTimestamp = 0;
        overlay.textContent = '';
        updateStatus('Course lancée. Bonne chance !');
        gameState.animationFrame = requestAnimationFrame(loop);
    };

    const togglePause = () => {
        if (!gameState.running) return;
        gameState.paused = !gameState.paused;
        if (gameState.paused) {
            cancelAnimationFrame(gameState.animationFrame);
            overlay.textContent = 'PAUSE';
            updateStatus('Pause activée. P ou Pause pour reprendre.');
        } else {
            overlay.textContent = '';
            updateStatus('Reprise ! Garde le rythme.');
            gameState.lastTimestamp = performance.now();
            gameState.animationFrame = requestAnimationFrame(loop);
        }
    };

    if (playerProfile.ip) {
        ensureIpLinkedHighScore();
    } else {
        try {
            fetch('https://api.ipify.org?format=json')
                .then((response) => (response.ok ? response.json() : null))
                .then((data) => {
                    if (!data || !data.ip) return;
                    playerProfile.ip = data.ip;
                    localStorage.setItem(STORAGE_KEYS.playerIp, playerProfile.ip);
                    ensureIpLinkedHighScore();
                })
                .catch(() => {});
        } catch (error) {
            // Ignore network issues for IP detection
        }
    }

    startButton?.addEventListener('click', startGame);
    pauseButton?.addEventListener('click', togglePause);

    if (jumpButton) {
        jumpButton.addEventListener('click', handleJump);
        jumpButton.addEventListener('touchstart', (event) => {
            event.preventDefault();
            handleJump();
        }, { passive: false });
    }

    if (dashButton) {
        const dashStart = (event) => {
            event.preventDefault();
            handleDashStart();
        };
        const dashEnd = (event) => {
            event.preventDefault();
            handleDashEnd();
        };
        ['mousedown', 'touchstart'].forEach((evt) => {
            dashButton.addEventListener(evt, dashStart, { passive: false });
        });
        ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((evt) => {
            dashButton.addEventListener(evt, dashEnd, { passive: false });
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space' || event.code === 'ArrowUp' || event.key === 'z' || event.key === 'Z') {
            event.preventDefault();
            handleJump();
        }

        if (event.code === 'ArrowDown' || event.key === 's' || event.key === 'S') {
            event.preventDefault();
            handleDashStart();
        }

        if (event.key === 'p' || event.key === 'P') {
            event.preventDefault();
            togglePause();
        }
    });

    document.addEventListener('keyup', (event) => {
        if (event.code === 'ArrowDown' || event.key === 's' || event.key === 'S') {
            handleDashEnd();
        }
    });

    updateStatus(gameState.message);
    updateScoreUI();
    overlay.textContent = 'READY';
});
