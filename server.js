const express = require('express');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3005;

const JWT_SECRET = "TheSalonBarber_Iquique_2026_SecretKey";
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'thesalonbarberagenda@gmail.com', // TU CORREO
        pass: 'dubfaxadvrovhvgw' // "Contraseña de Aplicación" de Google
    }
});

// Parse JSON bodies for API endpoints
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.get('/terminos', (req, res) => res.sendFile(path.join(__dirname, 'views', 'terminos.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'views', 'privacidad.html')));
app.get('/cancelacion', (req, res) => res.sendFile(path.join(__dirname, 'views', 'cancelacion.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'views', 'reset-password.html')));
app.get('/reset-password.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'reset-password.html')));
// RUTA PRINCIPAL
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
// RUTA ADMIN
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));
// Servir partial de calendario uso por index para inyección dinámica
app.get('/calendar.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'calendar.html')));
//RUTA PANEL BARBERO
app.get('/barbero.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'barbero.html')));
// API LISTA BLOQUEOS
app.get('/api/lista-bloqueos', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT b.nombre as barbero_nombre, d.fecha, d.motivo, d.tipo, d.hora_inicio, d.hora_fin 
            FROM dias_bloqueados d 
            JOIN barberos b ON d.barbero_id = b.id 
            ORDER BY d.fecha ASC
        `);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// DISPONIBILIDAD (Calcula horas libres reales)
app.get('/api/disponibilidad', async (req, res) => {
    const { barbero_id, fecha } = req.query; // fecha viene como "YYYY-MM-DD"
    try {
        if (!barbero_id || !fecha) return res.status(400).json([]);

        const horasPosibles = [
            "10:30", "11:30", "12:30", "13:30", "14:30",
            "15:30", "16:30", "17:30", "18:30", "19:30", "20:30", "21:30"
        ];

        // 1. Obtener estado del barbero
        const [barbRows] = await db.query('SELECT estado_horario FROM barberos WHERE id = ?', [barbero_id]);
        const estadoHorario = barbRows && barbRows.length ? Number(barbRows[0].estado_horario || 2) : 2;
        if (estadoHorario === 0) return res.json([]);

        let horasFiltradas = horasPosibles.slice();

        // 2. Filtro Horario Parcial
        if (estadoHorario === 1) {
            const parcial = new Set(["16:30","17:30","18:30","19:30","20:30","21:30"]);
            horasFiltradas = horasFiltradas.filter(h => parcial.has(h));
        }

        // 3. NUEVO: Filtrar horas pasadas SI la fecha es hoy
        const hoy = new Date();
        const fechaHoyStr = hoy.toISOString().split('T')[0]; // "2026-06-06"
        
        if (fecha === fechaHoyStr) {
            const horaActual = hoy.getHours();
            const minActual = hoy.getMinutes();
            // Filtramos: solo dejamos horas > hora actual
            horasFiltradas = horasFiltradas.filter(h => {
                const [h_res, m_res] = h.split(':').map(Number);
                return (h_res > horaActual) || (h_res === horaActual && m_res > minActual);
            });
        }

        // 4. Aplicar bloqueos de la BD
        const [bloqueos] = await db.query(
            'SELECT tipo, hora_inicio, hora_fin FROM dias_bloqueados WHERE barbero_id = ? AND fecha = ?',
            [barbero_id, fecha]
        );

        for (const b of bloqueos) {
            if (b.tipo === 'completo') return res.json([]);
            if (b.tipo === 'parcial' && b.hora_inicio && b.hora_fin) {
                const inicio = b.hora_inicio.substring(0,5);
                const fin = b.hora_fin.substring(0,5);
                horasFiltradas = horasFiltradas.filter(h => !(h >= inicio && h <= fin));
            }
        }

        // 5. Filtrar reservas existentes
        const [citasOcupadas] = await db.query(
            'SELECT hora FROM citas WHERE barbero_id = ? AND fecha = ? AND estado = "confirmada"',
            [barbero_id, fecha]
        );
        const horasReservadas = citasOcupadas.map(cita => (cita.hora || '').substring(0, 5));

        res.json(horasFiltradas.filter(hora => !horasReservadas.includes(hora)));
    } catch (error) { 
        console.error("Error en disponibilidad:", error);
        res.status(500).json({ error: error.message }); 
    }
});

// OBTENER SERVICIOS
app.get('/api/servicios', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM servicios WHERE activo = 1');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// OBTENER BARBEROS
app.get('/api/barberos', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM barberos WHERE activo = 1');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// LISTAR CITAS DE UN BARBERO
app.get('/api/barbero/citas/:id', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT c.id, c.barbero_id, c.servicio_id, c.fecha, c.hora, c.cliente_nombre, c.cliente_telefono, c.cliente_correo, c.estado,
                    s.nombre AS servicio
             FROM citas c
             LEFT JOIN servicios s ON c.servicio_id = s.id
             WHERE c.barbero_id = ?
             ORDER BY c.fecha ASC, c.hora ASC`,
            [req.params.id]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener citas del barbero:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// API CALENDARIO VISUAL
app.get('/api/fechas-bloqueadas/:barbero_id', async (req, res) => {
    const { barbero_id } = req.params;
    const isAdmin = req.query.admin === 'true'; 
    
    try {
        let query = "SELECT fecha FROM dias_bloqueados WHERE barbero_id = ?";
        if (!isAdmin) {
            query += " AND tipo = 'completo'"; 
        }
        
        const [rows] = await db.query(query, [barbero_id]);
        res.json(rows.map(r => {
            const date = new Date(r.fecha);
            return date.toISOString().split('T')[0];
        }));
    } catch (error) { 
        res.status(500).json([]); 
    }
});

// --- RUTA POST CITAS CORREGIDA ---
app.post('/api/citas', async (req, res) => {
    const { barbero_id, servicio_id, fecha, hora, cliente_nombre, cliente_telefono, cliente_correo } = req.body;

    // Validación de campos requeridos
    if (
        !barbero_id || !servicio_id || !fecha || !hora ||
        !cliente_nombre || !cliente_telefono || !cliente_correo
    ) {
        return res.status(400).json({ success: false, error: 'Faltan campos requeridos.' });
    }

    // Validación básica de formato de correo
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cliente_correo)) {
        return res.status(400).json({ success: false, error: 'Correo electrónico inválido.' });
    }

    // Validación básica de formato de fecha (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fecha)) {
        return res.status(400).json({ success: false, error: 'Formato de fecha inválido.' });
    }

    try {
        await db.query('INSERT INTO citas (barbero_id, servicio_id, fecha, hora, cliente_nombre, cliente_telefono, cliente_correo, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
        [barbero_id, servicio_id, fecha, hora, cliente_nombre, cliente_telefono, cliente_correo, 'confirmada']);

        const [barberos] = await db.query('SELECT nombre, email, instagram FROM barberos WHERE id = ?', [barbero_id]);
        const barbero = barberos[0];

        const telefonoLimpio = cliente_telefono.replace(/[^0-9]/g, '');
        let fechaFormateada = fecha;
        try {
            const [anio, mes, dia] = fecha.split('-');
            if(dia && mes) fechaFormateada = `${dia}/${mes}`;
        } catch(e) {}

        const mensajeBase = `Hola ${cliente_nombre}, te escribo de The Salon Barber. Confirmamos tu cita para el día ${fechaFormateada} a las ${hora} Hrs.`;
        const mensajeCodificado = encodeURIComponent(mensajeBase);
        const urlWhatsApp = `https://wa.me/${telefonoLimpio}?text=${mensajeCodificado}`;
        const urlLogo = "https://www.thesalonbarber.cl/images/logobarber.png?v=1"; 

        const instagramBarberoHTML = barbero?.instagram 
    ? `<div style="margin: 25px 0; text-align: center;">
           <p style="font-size: 15px; color: #ffffff; margin-bottom: 10px;">
               <strong>Conoce a tu barbero y a sus trabajos:</strong>
           </p>
           <a href="${barbero.instagram}" target="_blank" 
              style="background-color: #1a1a1a; border: 1px solid #F1C40F; color: #F1C40F; padding: 10px 20px; text-decoration: none; font-weight: bold; border-radius: 5px; display: inline-block; font-size: 14px;">
               📸 Ver Instagram
           </a>
       </div>` 
    : '';

        // Definimos el estilo base común para mantener la coherencia
        // Definimos los estilos basados en tu diseño original
        const estiloTabla = "width: 100%; max-width: 600px; margin: 0 auto; font-family: 'Poppins', Arial, sans-serif; background-color: #111111; color: #ffffff; border-collapse: collapse; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.3);";
        const estiloEncabezado = "padding: 30px; text-align: center; background-color: #1a1a1a; border-bottom: 2px solid #F1C40F;";
        const estiloCuerpo = "padding: 40px 30px; background-color: #141414;";
        const estiloCajaDatos = "background-color: #1a1a1a; border: 1px solid #2d2d2d; padding: 20px; border-radius: 8px; margin: 25px 0; text-align: left;";

        // 3. Estructuras de correo con tu DISEÑO ORIGINAL
        const mailCliente = {
            from: '"The Salon Barber" <thesalonbarberagenda@gmail.com>',
            to: cliente_correo,
            subject: '¡Tu cita ha sido confirmada! Gracias por tu confianza 💈',
            html: `
                <table style="${estiloTabla}">
                    <tr><td style="${estiloEncabezado}">
                        <img src="${urlLogo}" alt="The Salon Barber" style="max-width: 140px; height: auto;">
                        <h1 style="font-size: 22px; color: #F1C40F; margin: 15px 0 0 0; text-transform: uppercase; letter-spacing: 1px;">¡Cita Confirmada!</h1>
                    </td></tr>
                    <tr><td style="${estiloCuerpo}">
                        <p style="font-size: 18px; margin-top: 0;">Hola <strong>${cliente_nombre}</strong>,</p>
                        <p style="font-size: 15px; color: #cbd5e0; line-height: 1.6;">Queremos agradecer tu preferencia y la confianza que depositas en nuestro equipo para el cuidado de tu estilo. Tu espacio ha sido reservado de forma exitosa.</p>
                        <div style="${estiloCajaDatos}">
                            <h3 style="margin-top: 0; color: #F1C40F; border-bottom: 1px solid #2d2d2d; padding-bottom: 8px; font-size: 14px;">RESUMEN DE TU AGENDA</h3>
                            <p style="margin: 8px 0; color: #e2e8f0;"><strong>Profesional:</strong> ${barbero.nombre}</p>
                            <p style="margin: 8px 0; color: #e2e8f0;"><strong>Fecha:</strong> ${fechaFormateada}</p>
                            <p style="margin: 8px 0; color: #e2e8f0;"><strong>Horario:</strong> ${hora} Hrs</p>
                        </div>
                        ${instagramBarberoHTML}
                    </td></tr>
                </table>`
        };

        const mailBarbero = {
            from: '"The Salon Barber Sistema" <thesalonbarberagenda@gmail.com>',
            to: barbero.email,
            subject: `Nueva cita: ${cliente_nombre} (${hora} Hrs)`,
            html: `
                <table style="${estiloTabla}">
                    <tr>
                        <td style="${estiloEncabezado}">
                            <h1 style="font-size: 22px; color: #F1C40F; margin: 0;">💈 ¡Tienes una nueva cita!</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="${estiloCuerpo}">
                            <p style="font-size: 16px; color: #ffffff;">Hola <strong>${barbero.nombre}</strong>, un usuario ha reservado un espacio contigo.</p>
                            <div style="${estiloCajaDatos}">
                                <p style="margin: 5px 0; color: #e2e8f0;"><b>Cliente:</b> ${cliente_nombre}</p>
                                <p style="margin: 5px 0; color: #e2e8f0;"><b>Fecha:</b> ${fechaFormateada}</p>
                                <p style="margin: 5px 0; color: #e2e8f0;"><b>Hora:</b> ${hora} Hrs</p>
                                <p style="margin: 5px 0; color: #e2e8f0;"><b>Teléfono:</b> ${cliente_telefono}</p>
                            </div>
                            <div style="text-align: center; margin-top: 20px;">
                                <a href="${urlWhatsApp}" style="background-color: #25D366; color: white; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 5px; display: inline-block;">
                                    💬 Contactar por WhatsApp
                                </a>
                            </div>
                        </td>
                    </tr>
                </table>`
        };

        // 4. ENVÍO
        const envioCorreos = [];

        if (cliente_correo) {
            envioCorreos.push(transporter.sendMail(mailCliente)
                .then(() => console.log("✅ Mail cliente enviado"))
                .catch(err => console.error("❌ Error Cliente:", err)));
        }

        // DEPURACIÓN: Imprime esto en tu consola para ver qué está pasando
        console.log("Intentando enviar a:", barbero?.email);

        if (barbero && barbero.email) {
            envioCorreos.push(transporter.sendMail(mailBarbero)
                .then(() => console.log("✅ Mail barbero enviado a:", barbero.email))
                .catch(err => { console.error("❌ Error Barbero:", err); throw err; }));
        }

        const resultados = await Promise.allSettled(envioCorreos);
        const fallos = resultados.filter(r => r.status === 'rejected');
        if (fallos.length > 0) {
            console.error('Errores al enviar correos:', fallos.map(r => r.reason));
            return res.status(500).json({ success: false, error: 'No se pudieron enviar uno o más correos.' });
        }

        res.status(201).json({ success: true });

    } catch (error) { 
        console.error("Error:", error);
        res.status(500).json({ success: false, error: 'Error interno al reservar.' }); 
    }
});

// CAMBIAR ESTADO DE UNA CITA
app.post('/api/citas/cambiar-estado', async (req, res) => {
    const { cita_id, nuevo_estado, barbero_id } = req.body;
    
    if (!cita_id || !nuevo_estado || !barbero_id) {
        return res.status(400).json({ success: false, error: 'Faltan datos.' });
    }

    try {
        // Ejecutamos la actualización
        const [result] = await db.query(
            'UPDATE citas SET estado = ? WHERE id = ? AND barbero_id = ?', 
            [nuevo_estado, cita_id, barbero_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Cita no encontrada.' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error al cambiar estado:', error);
        res.status(500).json({ success: false, error: 'Error interno en la BD: ' + error.message });
    }
});

// ELIMINAR UNA CITA
app.delete('/api/citas/:id', async (req, res) => {
    const citaId = req.params.id;
    const barberoId = req.query.barbero_id;

    if (!citaId || !barberoId) {
        return res.status(400).json({ success: false, error: 'Faltan parámetros para eliminar la cita.' });
    }

    try {
        const [rows] = await db.query('SELECT barbero_id FROM citas WHERE id = ?', [citaId]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Cita no encontrada.' });
        }
        if (String(rows[0].barbero_id) !== String(barberoId)) {
            return res.status(403).json({ success: false, error: 'No tienes permiso para eliminar esta cita.' });
        }

        await db.query('DELETE FROM citas WHERE id = ?', [citaId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error al eliminar la cita:', error);
        res.status(500).json({ success: false, error: 'Error interno al eliminar la cita.' });
    }
});

// LOGIN Y REGISTRO
app.post('/api/registro', async (req, res) => {
    const { nombre, telefono, email, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, await bcrypt.genSalt(10));
        await db.query('INSERT INTO usuarios (nombre, email, password, telefono, rol) VALUES (?, ?, ?, ?, ?)', [nombre, email, hash, telefono, 'cliente']);
        res.json({ success: true, message: 'Creado.' });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM usuarios WHERE email = ?', [email]);
        if (rows.length === 0) {
            console.warn('Login fallido: usuario no encontrado para email=', email);
            return res.status(401).json({ success: false, error: 'Correo o contraseña incorrectos.' });
        }

        const match = await bcrypt.compare(password, rows[0].password);
        if (!match) {
            console.warn('Login fallido: contraseña incorrecta para user_id=', rows[0].id, 'email=', email);
            return res.status(401).json({ success: false, error: 'Correo o contraseña incorrectos.' });
        }
        res.json({ 
            success: true, 
            token: jwt.sign({ id: rows[0].id, rol: rows[0].rol }, JWT_SECRET, { expiresIn: '24h' }), 
            usuario: rows[0] 
        });
    } catch (error) {
        console.error("Error crítico en el login:", error);
        res.status(500).json({ success: false, error: 'Error interno del servidor al iniciar sesión.' });
    }
});

// BLOQUEAR DÍA
app.post('/api/bloquear-dia', async (req, res) => {
    const { barbero_id, fecha, motivo, tipo, hora_inicio, hora_fin } = req.body;
    try {
        await db.query(
            'INSERT INTO dias_bloqueados (barbero_id, fecha, motivo, tipo, hora_inicio, hora_fin) VALUES (?, ?, ?, ?, ?, ?)', 
            [barbero_id, fecha, motivo || 'Día libre', tipo || 'completo', hora_inicio || null, hora_fin || null]
        );
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// API PERFIL BARBERO
app.get('/api/barbero/:id', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM barberos WHERE id = ?', [req.params.id]);
        if (rows.length > 0) res.json(rows[0]);
        else res.status(404).json({ error: 'Barbero no encontrado' });
    } catch (error) { res.status(500).json({ error: 'Error interno' }); }
});

app.post('/api/barberos/horario/:id', async (req, res) => {
    const { estado } = req.body;
    const { id } = req.params;
    try {
        await db.query('UPDATE barberos SET estado_horario = ? WHERE id = ?', [estado, id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error al actualizar horario:', error);
        res.status(500).json({ error: 'Error al actualizar horario' });
    }
});

// ELIMINAR UN BLOQUEO
app.delete('/api/bloquear-dia', async (req, res) => {
    const { barbero_id, fecha } = req.body;
    try {
        await db.query('DELETE FROM dias_bloqueados WHERE barbero_id = ? AND fecha = ?', [barbero_id, fecha]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/perfil/:id', (req, res) => res.sendFile(path.join(__dirname, 'views', 'perfil.html')));

// RECUPERACIÓN DE CONTRASEÑA
app.post('/api/solicitar-reset-password', async (req, res) => {
    const { email } = req.body;
    try {
        const [rows] = await db.query('SELECT id, nombre FROM usuarios WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'El correo no está registrado.' });
        }

        // 1. Generar código de 6 dígitos
        const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
        const tokenHash = await bcrypt.hash(resetToken, await bcrypt.genSalt(10));
        const expiresAt = new Date(Date.now() + 3600000); 

        await db.query('UPDATE usuarios SET reset_token = ?, reset_expires = ? WHERE id = ?', 
            [tokenHash, expiresAt, rows[0].id]);

        // 2. URL de producción (asegura que el usuario llegue a tu web, no a localhost)
        const baseUrl = 'https://www.thesalonbarber.cl';
        const resetLink = `${baseUrl}/reset-password?email=${encodeURIComponent(email)}`;
        
        const mailOptions = {
            from: '"The Salon Barber" <thesalonbarberagenda@gmail.com>',
            to: email,
            subject: 'Código de recuperación - The Salon Barber',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5; border-radius: 8px;">
                    <div style="background: white; padding: 30px; border-radius: 8px; text-align: center;">
                        <h2 style="color: #eab308;">The Salon Barber</h2>
                        <p>Hola <strong>${rows[0].nombre}</strong>,</p>
                        <p>Tu código de seguridad para recuperar la contraseña es:</p>
                        
                        <div style="font-size: 32px; font-weight: bold; color: #eab308; margin: 20px 0; letter-spacing: 5px;">
                            ${resetToken}
                        </div>
                        
                        <p>⏰ Este código expira en 1 hora.</p>

                        <a href="${resetLink}" style="display: inline-block; background: #eab308; color: black; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0;">
                            Ir a cambiar contraseña
                        </a>
                        
                        <p style="font-size: 12px; color: #666;">Si no solicitaste esto, ignora este correo.</p>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Código enviado.' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: 'Error al procesar.' });
    }
});

// VALIDAR TOKEN DE RESET
app.post('/api/validar-token-reset', async (req, res) => {
    const { email, token } = req.body;
    try {
        const [rows] = await db.query('SELECT id, reset_token, reset_expires FROM usuarios WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
        }

        const user = rows[0];
        
        // Validar expiración
        if (!user.reset_expires || new Date() > new Date(user.reset_expires)) {
            return res.status(400).json({ success: false, error: 'El token ha expirado. Solicita uno nuevo.' });
        }

        // Validar token
        if (!user.reset_token || !await bcrypt.compare(token, user.reset_token)) {
            return res.status(400).json({ success: false, error: 'Token inválido.' });
        }

        res.json({ success: true, message: 'Token válido.' });
    } catch (error) {
        console.error('Error al validar token:', error);
        res.status(500).json({ success: false, error: 'Error al validar el token.' });
    }
});

// CAMBIAR CONTRASEÑA CON RESET TOKEN
app.post('/api/cambiar-password-reset', async (req, res) => {
    const { email, token, newPassword } = req.body;
    try {
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
        }

        const [rows] = await db.query('SELECT id, reset_token, reset_expires FROM usuarios WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
        }

        const user = rows[0];

        // Validar expiración
        if (!user.reset_expires || new Date() > new Date(user.reset_expires)) {
            return res.status(400).json({ success: false, error: 'El token ha expirado. Solicita uno nuevo.' });
        }

        // Validar token
        if (!user.reset_token || !await bcrypt.compare(token, user.reset_token)) {
            return res.status(400).json({ success: false, error: 'Token inválido.' });
        }

        // Cambiar contraseña
        const hash = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
        await db.query(
            'UPDATE usuarios SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
            [hash, user.id]
        );

        res.json({ success: true, message: 'Contraseña cambiada exitosamente.' });
    } catch (error) {
        console.error('Error al cambiar contraseña:', error);
        res.status(500).json({ success: false, error: 'Error al cambiar la contraseña.' });
    }
});

app.listen(3005, '0.0.0.0', () => console.log('Servidor escuchando en puerto 3005'));