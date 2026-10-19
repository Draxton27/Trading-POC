# Cierre del launcher Windows despues de un fallo

La ejecucion 39308149445 encontro una carrera en `startDev()`: el launcher iniciaba `taskkill /T /F`, pero no esperaba su cierre. Cuando el proceso `npm` que fallo emitia `close`, el launcher podia terminar antes de que `taskkill` hubiera eliminado Vite o sus descendientes. El smoke comprobaba los puertos en esa ventana y encontraba uno aun escuchando.

El launcher conserva ahora una barrera de finalizacion. Solo resuelve `completion`, fija su codigo de salida y retira sus manejadores de senal cuando todos los hijos cerraron y cada `taskkill` iniciado ya cerro. Si `taskkill` no puede iniciarse o falla, solicita el cierre del hijo directo y sigue esperando sus eventos. POSIX conserva el cierre por grupo de procesos. `SIGINT` y `SIGTERM` usan la misma barrera.

Para repetir en Windows, desde la raiz ejecute:

```powershell
npm ci
npm run typecheck
npm test
npm run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\dev-smoke.ps1
```

El smoke cubre una ruta con espacios, arranque normal, fallo inmediato, fallo despues de que Vite responde, puerto API ocupado y la comprobacion inmediata de que ningun puerto queda escuchando. La matriz de GitHub Actions para Node 22 y 24 debe revisarse en el run provocado por el commit de esta correccion; este informe no la marca como aprobada antes de que termine.
