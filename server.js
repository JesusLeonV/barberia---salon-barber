const express = require('express');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const app = express();
const PORT = process.env.PORT || 3005;

const JWT_SECRET = "TheSalonBarber_Iquique_2026_SecretKey";
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'thesalonbarberagenda@gmail.com', // TU CORREO
        pass: 'dubfaxadvrovhvgw' // "Contraseña de Aplicación" de Google, no tu contraseña normal
    }
});

// Parse JSON bodies for API endpoints
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// RUTA PRINCIPAL
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));

// RUTA ADMIN
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

// Servir partial de calendario (uso por index para inyección dinámica)
app.get('/calendar.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'calendar.html')));

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
//DISPONIBILIDAD
// DISPONIBILIDAD (Calcula horas libres reales)
app.get('/api/disponibilidad', async (req, res) => {
    const { barbero_id, fecha } = req.query;
    try {
        // 1. Revisamos si el barbero marcó ausencias en el panel Admin
        const [bloqueos] = await db.query('SELECT * FROM dias_bloqueados WHERE barbero_id = ? AND fecha = ?', [barbero_id, fecha]);
        
        // Si el admin bloqueó el día COMPLETO, devolvemos vacío (cero horas)
        if (bloqueos.some(b => b.tipo === 'completo')) {
            return res.json([]);
        }
        
        // Todas las horas de un día normal de trabajo
        const horasPosibles = ["10:30", "11:10", "11:50", "12:30", "13:10", "13:50", "14:30", "15:10", "15:50", "16:30", "17:10", "17:50", "18:30", "19:10", "19:50", "20:30"];
        let horasFiltradas = [...horasPosibles];
        
        // 2. Si el bloqueo es PARCIAL, descontamos esas horas
        bloqueos.forEach(b => {
            if (b.tipo === 'parcial' && b.hora_inicio && b.hora_fin) {
                const inicio = parseInt(b.hora_inicio.replace(':', '')); // ej: "14:30" -> 1430
                const fin = parseInt(b.hora_fin.replace(':', ''));       // ej: "16:30" -> 1630
                
                horasFiltradas = horasFiltradas.filter(h => {
                    const horaActual = parseInt(h.replace(':', ''));
                    // Filtramos las horas que caen dentro del trámite del barbero
                    return !(horaActual >= inicio && horaActual <= fin);
                });
            }
        });

        // 3. Revisamos qué horas YA FUERON RESERVADAS por otros clientes (Evita choques)
        const [citasOcupadas] = await db.query('SELECT hora FROM citas WHERE barbero_id = ? AND fecha = ?', [barbero_id, fecha]);
        const horasReservadas = citasOcupadas.map(cita => cita.hora.substring(0, 5));
        
        // Devolvemos las horas limpias (sin el permiso parcial y sin las citas de otros)
        res.json(horasFiltradas.filter(hora => !horasReservadas.includes(hora)));
    } catch (error) { 
        console.error(error);
        res.status(500).json({ error: 'Error' }); 
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


// API CALENDARIO VISUAL (NUEVA)
app.get('/api/fechas-bloqueadas/:barbero_id', async (req, res) => {
    const { barbero_id } = req.params;
    
    // Detectamos si el que pregunta es el Panel Admin o el Cliente normal
    const isAdmin = req.query.admin === 'true'; 
    
    try {
        let query = "SELECT fecha FROM dias_bloqueados WHERE barbero_id = ?";
        
        // Si el que mira es el CLIENTE, solo tachamos el día si la ausencia es "completo".
        // Si es "parcial", no lo enviamos aquí para que el cliente pueda hacerle clic.
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

app.post('/api/citas', async (req, res) => {
    const { barbero_id, servicio_id, fecha, hora, cliente_nombre, cliente_telefono, cliente_correo } = req.body;
    
    try {
        // 1. Guardar cita en la base de datos
        await db.query('INSERT INTO citas (barbero_id, servicio_id, fecha, hora, cliente_nombre, cliente_telefono, cliente_correo, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
        [barbero_id, servicio_id, fecha, hora, cliente_nombre, cliente_telefono, cliente_correo, 'confirmada']);

        // 2. Buscar datos del barbero seleccionado
        const [barberos] = await db.query('SELECT nombre, email FROM barberos WHERE id = ?', [barbero_id]);
        const barbero = barberos[0];

        // --- LÓGICA NUEVA PARA EL BOTÓN DE WHATSAPP ---
        // Limpiamos el teléfono del cliente quitándole espacios, guiones o el símbolo "+" 
        // para asegurarnos de que la API de WhatsApp no falle.
        const telefonoLimpio = cliente_telefono.replace(/[^0-9]/g, '');

        // Formateamos la fecha a algo más amigable si viene en formato AAAA-MM-DD
        let fechaFormateada = fecha;
        try {
            const [anio, mes, dia] = fecha.split('-');
            if(dia && mes) fechaFormateada = `${dia}/${mes}`;
        } catch(e) { /* Si falla mantiene el formato original */ }

        // Creamos el texto codificado para la URL de WhatsApp
        const mensajeBase = `Hola ${cliente_nombre}, te escribo de The Salon Barber. Confirmamos tu cita para el día ${fechaFormateada} a las ${hora} Hrs.`;
        const mensajeCodificado = encodeURIComponent(mensajeBase);
        const urlWhatsApp = `https://wa.me/${telefonoLimpio}?text=${mensajeCodificado}`;
        // ----------------------------------------------

        // 3. ENVIAR CORREO AL CLIENTE (Confirmación)
        const mailCliente = {
            from: '"The Salon Barber" <thesalonbarberagenda@gmail.com>', // Usa la misma cuenta autenticada
            to: cliente_correo,
            subject: '¡Tu cita ha sido confirmada! 💈',
            html: `<h2>Hola ${cliente_nombre}</h2>
                   <p>Tu reserva con <b>${barbero.nombre}</b> está confirmada.</p>
                   <p>Fecha: <b>${fechaFormateada}</b><br>Hora: <b>${hora} Hrs</b></p>
                   <p>¡Te esperamos!</p>`
        };

        // 4. ENVIAR CORREO AL BARBERO (Notificación con botón de contacto inmediato)
        const mailBarbero = {
            from: '"The Salon Barber Sistema" <thesalonbarberagenda@gmail.com>',
            to: barbero.email,
            subject: `Nueva cita agendada - ${cliente_nombre} (${hora} Hrs)`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #2c3e50; margin-top: 0;">💈 ¡Tienes una nueva cita!</h2>
                    <p style="font-size: 16px;">Hola <b>${barbero.nombre}</b>, un usuario ha reservado un espacio contigo.</p>
                    
                    <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                        <p style="margin: 5px 0;"><b>Cliente:</b> ${cliente_nombre}</p>
                        <p style="margin: 5px 0;"><b>Fecha:</b> ${fechaFormateada}</p>
                        <p style="margin: 5px 0;"><b>Hora:</b> ${hora} Hrs</p>
                        <p style="margin: 5px 0;"><b>Teléfono:</b> ${cliente_telefono}</p>
                    </div>
                    
                    <p style="font-size: 14px; color: #555;">Haz clic en el siguiente botón para abrir su chat de WhatsApp con el recordatorio listo para enviar:</p>
                    
                    <div style="text-align: center; margin-top: 20px;">
                        <a href="${urlWhatsApp}" target="_blank" style="background-color: #25D366; color: white; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 5px; display: inline-block; font-size: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            💬 Contactar por WhatsApp
                        </a>
                    </div>
                </div>
            `
        };

        // Ejecutar los envíos de manera segura para que fallos individuales no rompan la respuesta
        try {
            transporter.sendMail(mailCliente, (err, info) => { 
                if(err) {
                    console.error("❌ ERROR EN MAIL CLIENTE:", err.message);
                } else {
                    console.log("✅ Mail cliente enviado con éxito:", info.response);
                }
            });
        } catch (mailErr) {
            console.error("❌ Fallo crítico disparando mailCliente:", mailErr);
        }

        try {
            transporter.sendMail(mailBarbero, (err, info) => { 
                if(err) {
                    console.error("❌ ERROR EN MAIL BARBERO:", err.message);
                } else {
                    console.log("✅ Mail barbero enviado con éxito:", info.response);
                }
            });
        } catch (mailErr) {
            console.error("❌ Fallo crítico disparando mailBarbero:", mailErr);
        }

        // Enviamos la respuesta 201 al cliente inmediatamente
        res.status(201).json({ success: true });
    } catch (error) { 
        console.error("Error al agendar o enviar correo:", error);
        res.status(500).json({ success: false, error: 'Error al procesar reserva' }); 
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
//LOGIN
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const [rows] = await db.query('SELECT * FROM usuarios WHERE email = ?', [email]);
        
        if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password))) {
            return res.status(401).json({ success: false, error: 'Correo o contraseña incorrectos.' });
        }
        
        res.json({ 
            success: true, 
            token: jwt.sign({ id: rows[0].id, rol: rows[0].rol }, JWT_SECRET, { expiresIn: '24h' }), 
            usuario: rows[0] 
        });

    } catch (error) {
        // ESTO ES CLAVE: Imprimirá el error real en la terminal de tu servidor
        console.error("Error crítico en el login:", error);
        
        // Y le responderá al frontend para que no se quede "colgado"
        res.status(500).json({ success: false, error: 'Error interno del servidor al iniciar sesión.' });
    }
});

// BLOQUEAR DÍA (ÚNICA DEFINICIÓN)
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
// ELIMINAR UN BLOQUEO
app.delete('/api/bloquear-dia', async (req, res) => {
    const { barbero_id, fecha } = req.body;
    try {
        await db.query('DELETE FROM dias_bloqueados WHERE barbero_id = ? AND fecha = ?', [barbero_id, fecha]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});
// Asegúrate de servir el perfil
app.get('/perfil/:id', (req, res) => res.sendFile(path.join(__dirname, 'views', 'perfil.html')));

app.listen(3005, '0.0.0.0', () => console.log('Servidor escuchando en puerto 3005'));