require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const Redis = require('ioredis');
const xss = require('xss');

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3005;

// --- REDIS CLIENT ---
const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'redis-barberia',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
});

redisClient.on('connect', () => console.log('Redis conectado'));
redisClient.on('error', (err) => console.error('Redis error:', err.message));

// --- SEGURIDAD ---
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// --- RATE LIMITING ---
function normalizeIp(ip) {
    if (!ip) return 'unknown';
    if (ip.startsWith('::ffff:')) return ip.substring(7);
    if (ip === '::1') return '127.0.0.1';
    return ip;
}

const globalLimiter = rateLimit({
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
        prefix: 'rl:global:',
    }),
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Demasiadas peticiones. Intenta mas tarde.' },
    keyGenerator: (req) => normalizeIp(req.ip),
});

app.use(globalLimiter);

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// --- FUNCIONES AUXILIARES ---
function sanitize(str) {
    if (!str) return '';
    return xss(String(str).trim());
}

// --- RUTAS EST??TICAS ---
app.get('/terminos', (req, res) => res.sendFile(path.join(__dirname, 'views', 'terminos.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'views', 'privacidad.html')));
app.get('/cancelacion', (req, res) => res.sendFile(path.join(__dirname, 'views', 'cancelacion.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));

// --- APIs P??BLICAS ---
app.get('/api/servicios', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM servicios WHERE activo = 1');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/barberos', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, nombre, foto_url, instagram, whatsapp, bio, estado_horario, activo FROM barberos WHERE activo = 1');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/barbero/:id', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, nombre, foto_url, instagram, whatsapp, bio, estado_horario FROM barberos WHERE id = ?', [req.params.id]);
        if (rows.length > 0) res.json(rows[0]);
        else res.status(404).json({ error: 'Barbero no encontrado' });
    } catch (error) { res.status(500).json({ error: 'Error interno' }); }
});

app.get('/api/opiniones', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT o.id, o.cliente_nombre, o.calificacion, o.comentario, o.created_at,
                    b.nombre AS barbero_nombre, s.nombre AS servicio_nombre
             FROM opiniones o
             LEFT JOIN barberos b ON o.barbero_id = b.id
             LEFT JOIN servicios s ON o.servicio_id = s.id
             WHERE o.aprobada = 1
             ORDER BY o.created_at DESC LIMIT 20`
        );
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/opiniones', async (req, res) => {
    const { cliente_nombre, calificacion, comentario, barbero_id, servicio_id } = req.body;
    if (!cliente_nombre || !calificacion) {
        return res.status(400).json({ error: 'Nombre y calificacion son requeridos' });
    }
    if (calificacion < 1 || calificacion > 5) {
        return res.status(400).json({ error: 'Calificacion debe ser entre 1 y 5' });
    }
    try {
        const safeNombre = cliente_nombre.replace(/[<>]/g, '').substring(0, 100);
        const safeComentario = (comentario || '').replace(/[<>]/g, '').substring(0, 500);
        await db.query(
            'INSERT INTO opiniones (cliente_nombre, calificacion, comentario, barbero_id, servicio_id, aprobada) VALUES (?, ?, ?, ?, ?, 0)',
            [safeNombre, calificacion, safeComentario, barbero_id || null, servicio_id || null]
        );
        res.json({ ok: true, mensaje: 'Opinion enviada.' });
    } catch (error) {
        console.error("Error guardando opinion:", error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// --- INICIAR SERVIDOR ---
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor escuchando en puerto ${PORT}`));

