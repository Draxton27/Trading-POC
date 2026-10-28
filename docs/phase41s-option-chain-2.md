# Fase 41S: cadena de opciones NVDA

Esta rama se apila sobre `codex/phase41r-ibkr-gateway` ([PR #78](https://github.com/Draxton27/Trading-POC/pull/78)). El PR 41S debe revisarse contra esa rama mientras 41R permanezca abierto.

## Arquitectura

`GET /api/v1/options/chain` presenta CALL y PUT en el mismo nivel de strike. Acepta `consumerId` UUID, `expiration` IBKR opcional, `strikeLevels=3|5`, `side=BOTH|CALL|PUT` y `centerStrike` positivo opcional. Consulta hasta seis definiciones inicialmente, o diez al ampliar a cinco strikes. El límite de diez suscripciones de `AgentHub` es global para cadena, comparador y Radar; un presupuesto agotado deja visible la definición resuelta y su error de suscripción. Nunca consulta toda la cadena ni cambia SIP/IEX o el modo Paper.

Las dos caras usan `loadContract`, que comparte `validateResolved`, `validateOptionIdentity`, caché de contratos, resolución acotada, suscripción por consumidor y evaluación documental. Una falla de CALL no oculta PUT. `GET /api/v1/options/quotes?conIds=...` refresca solo cotizaciones de contratos ya resueltos; no abre suscripciones. Los consumidores visibles se liberan al cambiar el filtro o salir de Opciones. El detalle y cada comparación tienen consumidores independientes, de modo que una liberación no desconecta otro uso activo del mismo contrato.

Sin precio admisible, la API no elige el punto medio de strikes: solicita escoger un centro manual. La referencia puede ser un último precio IBKR LIVE reciente, una última vela completa IEX con proceso y feed activos, un strike manual, o DEMO sintético. La vela IEX es una aproximación observada, no un tick actual. La clasificación ITM/OTM solo aparece con una referencia de precio admisible; una elección manual de strike no se convierte en precio del subyacente.

## Interfaz y significado económico

Los vencimientos proceden de IBKR y se muestran en pestañas con selector para fechas lejanas. La tabla alinea CALL y PUT por strike, con BID, ASK, spread porcentual, costo bruto y calidad de cotización. La vista móvil muestra un lado por vez. La comparación fija hasta cuatro contratos por `conId` y señala que lados y vencimientos distintos no son resultados equivalentes. Al cambiar filtro se cierra el detalle; una comparación fijada sigue identificada por su contrato.

El panel lateral utiliza los cálculos 41L para costo, pérdida máxima bruta, spread, punto de equilibrio y capital hipotético. Las comisiones desconocidas no se convierten en cero. El rango ASK de la academia conserva su fecha y vigencia documental; no es un rango del precio de NVDA ni una recomendación actual. Se muestran escenarios Investep y SMA mediante el endpoint existente de Radar, separados de la cotización del contrato. Si se abre un contrato desde Radar, se conserva el `conId` exacto y la evidencia del candidato; no se sustituye por un strike cercano. El simulador 41M solo registra una entrada hipotética tras confirmación manual. No hay órdenes IBKR.

Las explicaciones de prima, spread, strike, DTE y equilibrio están plegadas por defecto. Las preferencias de visualización se guardan en `localStorage`; no contienen cuenta ni secretos y no cambian reglas económicas o de riesgo. Los colores distinguen CALL y PUT, sin representar conveniencia de compra.

Una definición válida no garantiza BID/ASK, permisos OPRA ni posibilidad de ejecución. La API conserva `N/D` cuando faltan precios, tamaños, volumen, open interest o griegas. El feed y timestamps de mercado/recepción se muestran en el detalle avanzado. La calidad `LIVE_RECENT` depende del verificador de 41L; no se genera un timestamp de mercado ficticio.

## Validación

Las pruebas API cubren ambos lados por strike, seis y diez definiciones, errores independientes, normalización IBKR y refresco GET sin suscripciones. Las pruebas de interfaz cubren selección, comparación, cambios de filtro, panel, vista móvil, ausencia de precios y Gateway desconectado. Las capturas E2E se guardan en `test-results/phase41s-chain/`, ignorado por Git.

Comandos Windows:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Las pruebas DEMO y mocks no acreditan una cotización OPRA ni una sesión Gateway real. Un código de identidad incompatible o un permiso denegado permanece como error específico por contrato.
