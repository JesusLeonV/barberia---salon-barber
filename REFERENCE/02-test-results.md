# The Salon Barber - Test Results (2026-07-12)

## Setup
- Created barbero "Jesus Leon" (id=9, barbero_id=9) with email jesus01012005@gmail.com
- Created usuario (id=18, rol=barbero, barbero_id=9) with password test1234
- estado_horario=2 (full schedule: 10:30-21:30)

## Test Results

### Login
- POST /api/login with jesus01012005@gmail.com / test1234: SUCCESS
- Returns JWT token (24h expiry) + user info

### Availability
- GET /api/disponibilidad?barbero_id=9&fecha=2026-07-15: All 12 slots available
- After booking 15:30: 11 slots available (15:30 removed)
- After blocking July 20 (completo): 0 slots
- After blocking July 22 (parcial 10:30-15:30): 6 slots (16:30+)

### Booking (POST /api/citas)
- Booked "Corte de cabello" on 2026-07-15 at 15:30: SUCCESS
- Sends confirmation email to client + notification email to barber
- Slot immediately removed from availability

### Block Day (POST /api/bloquear-dia)
- Full block on 2026-07-20: All slots removed
- Partial block on 2026-07-22 (10:30-15:30): Only afternoon slots remain

### Barber Appointments (GET /api/barbero/citas/:id)
- Returns all appointments for barbero_id=9 with service name

### Change Status (POST /api/citas/cambiar-estado)
- Changed appointment 39 from "confirmada" to "asistio": SUCCESS

### Opinions (POST /api/opiniones)
- Submitted 5-star opinion: SUCCESS (pending approval)

### Blocked Dates (GET /api/fechas-bloqueadas/:barbero_id)
- Admin=true: Returns all blocked dates (completo + parcial)
- Admin=false: Returns only completo blocked dates

## Notes
- Server runs on container port 3005, mapped to host port 3006
- Nginx proxies thesalonbarber.cl to barberia-node-app:3005 (internal Docker network)
- Rate limiter requires trust proxy setting (added)
- MySQL root password is "admin" (from existing volume, not docker-compose)
- All emails sent from thesalonbarberagenda@gmail.com