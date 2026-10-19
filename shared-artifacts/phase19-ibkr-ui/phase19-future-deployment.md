# Despliegue privado futuro

El diseño de servidor está documentado en docs/phase19-future-deployment.md. En esta fase web/API solo escuchan en localhost y no se publica acceso remoto. Si B migra a un servidor privado, A permanece con TWS y agente; solo cambia la IP privada destino. El servidor alojaría la API, web construida, SQLite/diarios, secretos independientes y CSV con acceso autorizado, en directorios separados.

Antes de abrir acceso remoto son obligatorios login de usuarios, autorización por recurso/cuenta, TLS, CSRF y WebSocket protegidos, rotación de secretos, firewall, límites, trazabilidad, respaldo/restauración y revisión contractual SIP/OPRA. Tailscale Funnel no es parte del diseño. Nunca mover contraseña, segundo factor o sesión TWS al servidor. Live continúa deshabilitado.
