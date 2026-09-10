# The Salon Barber - Project Reference

## Server
- IP: 100.76.140.47 (Tailscale)
- SSH: jesus@100.76.140.47
- Domain: thesalonbarber.cl (via Cloudflare tunnel)

## Infrastructure
- Project path: /home/jesus/servidor-final/www/barberia/
- Docker compose: /home/jesus/servidor-final/docker-compose.yml
- Container: barberia-node-app (3006->3005)
- DB: MySQL (mysql-db container), database: barberia_db, user: root, password: admin
- Nginx: outer nginx proxies thesalonbarber.cl to barberia-node-app:3005

## Tech Stack
- Backend: Node.js + Express
- DB: MySQL (mysql2/promise)
- Auth: JWT (24h expiry), bcrypt for passwords
- Email: nodemailer (Gmail SMTP)
- Security: helmet, express-rate-limit, xss

## DB Schema

### usuarios
- id (INT, PK, auto_increment)
- nombre (VARCHAR 100)
- email (VARCHAR 100, UNIQUE)
- password (VARCHAR 255, bcrypt hash)
- telefono (VARCHAR 20)
- rol (ENUM: cliente, barbero, admin)
- barbero_id (INT, FK -> barberos.id, nullable)
- reset_token, reset_expires (password recovery)

### barberos
- id (INT, PK, auto_increment)
- nombre (VARCHAR 100)
- foto_url (VARCHAR 255)
- activo (TINYINT, default 1)
- email (VARCHAR 100)
- telefono (VARCHAR 20)
- bio (TEXT)
- password (VARCHAR 255)
- instagram (VARCHAR 255)
- whatsapp (VARCHAR 20)
- estado_horario (INT: 0=closed, 1=partial 16:30-21:30, 2=full 10:30-21:30)

### citas
- id (INT, PK, auto_increment)
- barbero_id (INT, FK)
- servicio_id (INT, FK)
- cliente_nombre, cliente_telefono, cliente_correo
- fecha (DATE), hora (VARCHAR 10)
- estado (ENUM: confirmada, asistio, cancelada, no_llego)
- fecha_cita, hora_cita (legacy fields, nullable)

### dias_bloqueados
- id (INT, PK, auto_increment)
- barbero_id (INT, FK)
- fecha (DATE)
- motivo (VARCHAR 255)
- tipo (VARCHAR 20: completo, parcial)
- hora_inicio, hora_fin (VARCHAR 10, for parcial)

### servicios
- id (INT, PK, auto_increment)
- nombre, descripcion, precio (INT), duracion_minutos (INT), categoria, activo

### opiniones
- id, cliente_nombre, cliente_telefono, calificacion (1-5), comentario
- barbero_id, servicio_id, aprobada (0=pending, 1=approved)

## API Endpoints

### Public (no auth)
- GET /api/barberos - list active barbers
- GET /api/barbero/:id - get barber by id
- GET /api/servicios - list active services
- GET /api/disponibilidad?barbero_id=&fecha=&tz= - available hours
- GET /api/fechas-bloqueadas/:barbero_id - blocked dates (full only for clients)
- GET /api/lista-bloqueos - all blocks with barber name
- GET /api/opiniones - approved opinions
- POST /api/opiniones - submit opinion (needs approval)

### Auth
- POST /api/registro - register (cliente)
- POST /api/login - login, returns JWT + user

### Protected (JWT + barbero/admin role)
- POST /api/citas - create appointment (sends emails to client + barber)
- POST /api/citas/cambiar-estado - change appointment status
- DELETE /api/citas/:id - delete appointment
- POST /api/bloquear-dia - block day (completo/parcial)
- DELETE /api/bloquear-dia - unblock day
- POST /api/barberos/horario/:id - update barber schedule state
- GET /api/barbero/citas/:id - get barber's appointments

### Password Recovery
- POST /api/solicitar-reset-password - send 6-digit code
- POST /api/validar-token-reset - validate code
- POST /api/cambiar-password-reset - change password with code

## Available Time Slots
10:30, 11:30, 12:30, 13:30, 14:30, 15:30, 16:30, 17:30, 18:30, 19:30, 20:30, 21:30

## estado_horario
- 0 = Closed (no slots)
- 1 = Partial: 16:30, 17:30, 18:30, 19:30, 20:30, 21:30
- 2 = Full: all slots

## Existing Users
| id | nombre | email | rol |
|----|--------|-------|-----|
| 1 | Luis | Luisapll746@gmail.com | barbero |
| 2 | Matias | salinasantezanam@gmail.com | barbero |

## Existing Barbers
| id | nombre | email | activo | estado_horario |
|----|--------|-------|--------|---------------|
| 1 | Luis | Luisapll746@gmail.com | 1 | 1 (partial) |
| 2 | Matias | salinasantezanam@gmail.com | 1 | 1 (default) |
| 3 | Alexis | jeanalexis.8@hotmail.es | 0 (inactive) | - |

## Build & Deploy
```bash
# Rebuild container
cd /home/jesus/servidor-final
docker compose up -d --build barberia-node-app

# Check logs
docker logs barberia-node-app -f

# Restart
docker restart barberia-node-app
```

## Email Config
- From: The Salon Barber <thesalonbarberagenda@gmail.com>
- Service: Gmail SMTP (nodemailer)
- Used for: appointment confirmations, password recovery
- Both client and barber receive email on booking

## Views
- index.html - Landing page with booking
- admin.html - Admin panel
- barbero.html - Barber dashboard
- calendar.html - Calendar view
- reset-password.html - Password recovery
- terminos.html, privacidad.html, cancelacion.html - Legal pages